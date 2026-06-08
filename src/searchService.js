const { Client } = require('@elastic/elasticsearch');

class SearchService {
  constructor(logger) {
    this.logger = logger;
    this.client = null;
    this.mode = 'memory';
    this.moviesIndex = 'movies';
    this.cinemasIndex = 'cinemas';
    this.connectionCheckInProgress = false;
  }

  async connect() {
    try {
      this.client = new Client({
        node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
        maxRetries: 3,
        requestTimeout: 5000,
      });

      // 检查连接
      await this.client.ping();
      this.mode = 'elasticsearch';
      
      // 创建索引（如果不存在）
      await this.createIndices();
      
      this.logger.info('Elasticsearch connected and indices ready');
      return true;
    } catch (error) {
      this.mode = 'memory';
      this.logger.warn({ error: error.message }, 'Elasticsearch unavailable, using in-memory fallback');
      return false;
    }
  }

  async createIndices() {
    if (!this.client || this.mode !== 'elasticsearch') return;

    try {
      // 创建影片索引
      const moviesIndexExists = await this.client.indices.exists({ index: this.moviesIndex });
      if (!moviesIndexExists) {
        await this.client.indices.create({
          index: this.moviesIndex,
          body: {
            settings: {
              analysis: {
                analyzer: {
                  chinese_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'asciifolding']
                  }
                }
              }
            },
            mappings: {
              properties: {
                id: { type: 'keyword' },
                title: { type: 'text', analyzer: 'chinese_analyzer' },
                genre: { type: 'text', analyzer: 'chinese_analyzer' },
                director: { type: 'text', analyzer: 'chinese_analyzer' },
                cast: { type: 'text', analyzer: 'chinese_analyzer' },
                tagline: { type: 'text', analyzer: 'chinese_analyzer' },
                synopsis: { type: 'text', analyzer: 'chinese_analyzer' },
                tags: { type: 'keyword' },
                language: { type: 'keyword' },
                format: { type: 'keyword' },
                cinema: { type: 'text', analyzer: 'chinese_analyzer' },
                hall: { type: 'keyword' },
                rating: { type: 'float' },
                heat: { type: 'integer' },
                duration: { type: 'integer' },
                boxOffice: { type: 'keyword' },
                releaseDate: { type: 'date' }
              }
            }
          }
        });
        this.logger.info(`Created index: ${this.moviesIndex}`);
      }

      // 创建影院索引
      const cinemasIndexExists = await this.client.indices.exists({ index: this.cinemasIndex });
      if (!cinemasIndexExists) {
        await this.client.indices.create({
          index: this.cinemasIndex,
          body: {
            settings: {
              analysis: {
                analyzer: {
                  chinese_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'asciifolding']
                  }
                }
              }
            },
            mappings: {
              properties: {
                name: { type: 'text', analyzer: 'chinese_analyzer' },
                address: { type: 'text', analyzer: 'chinese_analyzer' },
                distance: { type: 'keyword' },
                serviceTags: { type: 'keyword' }
              }
            }
          }
        });
        this.logger.info(`Created index: ${this.cinemasIndex}`);
      }
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to create Elasticsearch indices');
    }
  }

  async indexMovies(movies) {
    if (!this.client || this.mode !== 'elasticsearch') return;

    try {
      const operations = movies.flatMap(movie => 
        movie.shows.flatMap(show => [
          { index: { _index: this.moviesIndex, _id: `${movie.id}-${show.id}` } },
          {
            ...movie,
            cinema: show.cinema,
            hall: show.hall,
            format: show.format,
            language: show.language,
            startsAt: show.startsAt,
            price: show.price,
            address: show.address,
            distance: show.distance,
            serviceTags: show.serviceTags,
            seats: show.seats,
            sold: show.sold
          }
        ])
      );

      if (operations.length > 0) {
        const response = await this.client.bulk({ refresh: true, operations });
        if (response.errors) {
          this.logger.error('Some documents failed to index');
        } else {
          this.logger.info(`Indexed ${operations.length / 2} movie-show documents`);
        }
      }
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to index movies');
    }
  }

  async indexCinemas(cinemas) {
    if (!this.client || this.mode !== 'elasticsearch') return;

    try {
      const operations = cinemas.flatMap(cinema => [
        { index: { _index: this.cinemasIndex, _id: cinema.name } },
        cinema
      ]);

      if (operations.length > 0) {
        const response = await this.client.bulk({ refresh: true, operations });
        if (response.errors) {
          this.logger.error('Some cinemas failed to index');
        } else {
          this.logger.info(`Indexed ${cinemas.length} cinema documents`);
        }
      }
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to index cinemas');
    }
  }

  async search(query, options = {}) {
    if (!this.client || this.mode !== 'elasticsearch') {
      // 降级到内存搜索，需要外部传入数据
      return { q: query, movies: [], cinemas: [] };
    }

    try {
      const q = query.trim().toLowerCase();
      if (!q) {
        return { q, movies: [], cinemas: [] };
      }

      // 同时搜索影片和影院
      const [movieResults, cinemaResults] = await Promise.all([
        this.searchMovies(q, options),
        this.searchCinemas(q, options)
      ]);

      return {
        q,
        movies: movieResults,
        cinemas: cinemaResults
      };
    } catch (error) {
      this.logger.error({ error: error.message, query }, 'Elasticsearch search failed');
      return { q: query, movies: [], cinemas: [] };
    }
  }

  async searchMovies(query, options) {
    if (!this.client || this.mode !== 'elasticsearch') return [];

    try {
      const response = await this.client.search({
        index: this.moviesIndex,
        body: {
          size: options.limit || 50,
          query: {
            multi_match: {
              query,
              fields: [
                'title^3',      // 标题权重最高
                'tags^2',       // 标签权重次高
                'genre',        // 类型
                'director',     // 导演
                'cast',         // 演员
                'tagline',      // 宣传语
                'synopsis',     // 简介
                'cinema',       // 影院名
                'hall',         // 影厅
                'format',       // 格式
                'language'      // 语言
              ],
              type: 'best_fields',
              fuzziness: 'AUTO'
            }
          },
          collapse: {
            field: 'id',
            inner_hits: {
              name: 'shows',
              size: 3,
              sort: [{ price: 'asc' }]
            }
          }
        }
      });

      // 处理聚合结果，合并相同影片的不同场次
      const uniqueMovies = new Map();
      response.hits.hits.forEach(hit => {
        const movieId = hit._source.id;
        if (!uniqueMovies.has(movieId)) {
          const movie = { ...hit._source };
          // 从inner_hits获取场次信息
          if (hit.inner_hits && hit.inner_hits.shows && hit.inner_hits.shows.hits.hits.length > 0) {
            movie.shows = hit.inner_hits.shows.hits.hits.map(showHit => {
              const showSource = showHit._source;
              return {
                id: showHit._id.split('-')[1],
                startsAt: showSource.startsAt,
                price: showSource.price,
                hall: showSource.hall,
                cinema: showSource.cinema,
                address: showSource.address,
                distance: showSource.distance,
                format: showSource.format,
                language: showSource.language,
                serviceTags: showSource.serviceTags,
                seats: [], // 不包含座位信息
                sold: []   // 不包含已售信息
              };
            });
          }
          uniqueMovies.set(movieId, movie);
        }
      });

      return Array.from(uniqueMovies.values());
    } catch (error) {
      this.logger.error({ error: error.message }, 'Elasticsearch movie search failed');
      return [];
    }
  }

  async searchCinemas(query, options) {
    if (!this.client || this.mode !== 'elasticsearch') return [];

    try {
      const response = await this.client.search({
        index: this.cinemasIndex,
        body: {
          size: options.limit || 20,
          query: {
            multi_match: {
              query,
              fields: [
                'name^3',        // 影院名权重最高
                'address^2',     // 地址权重次高
                'serviceTags'    // 服务标签
              ],
              fuzziness: 'AUTO'
            }
          }
        }
      });

      return response.hits.hits.map(hit => hit._source);
    } catch (error) {
      this.logger.error({ error: error.message }, 'Elasticsearch cinema search failed');
      return [];
    }
  }

  // 内存搜索兜底
  searchInMemory(query, options, movies, cinemas) {
    const q = query.trim().toLowerCase();
    if (!q) return { q, movies: [], cinemas: [] };

    // 如果没有传入数据，返回空结果
    if (!movies || !cinemas) {
      return { q, movies: [], cinemas: [] };
    }

    const movieHits = movies.filter(movie => {
      const text = [
        movie.title,
        movie.genre,
        movie.director,
        movie.tagline,
        movie.synopsis,
        ...(movie.tags || []),
        ...(movie.cast || []),
        ...movie.shows.flatMap(show => [show.cinema, show.format, show.hall, show.language]),
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });

    const cinemaHits = cinemas.filter(cinema => 
      [cinema.name, cinema.address, ...(cinema.serviceTags || [])]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );

    return { q, movies: movieHits, cinemas: cinemaHits };
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
  }

  // 用于定期重试连接
  async healthCheck() {
    if (this.mode === 'memory' && !this.connectionCheckInProgress) {
      this.connectionCheckInProgress = true;
      try {
        this.logger.info('Checking if Elasticsearch is available...');
        const client = new Client({
          node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
          requestTimeout: 3000,
        });
        
        await client.ping();
        this.client = client;
        this.mode = 'elasticsearch';
        await this.createIndices();
        this.logger.info('Elasticsearch reconnected successfully');
      } catch (error) {
        // 保持内存模式
        if (this.client) {
          try {
            await this.client.close();
          } catch (e) {
            // 忽略关闭错误
          }
          this.client = null;
        }
      } finally {
        this.connectionCheckInProgress = false;
      }
    }
    return this.mode;
  }
}

module.exports = SearchService;