const { COLS, ROWS, readDatabase, updateDatabase } = require("./database");

function attachShows(db) {
  return db.movies.map((movie) => ({
    ...movie,
    shows: db.shows.filter((show) => show.movieId === movie.id).map((show) => ({ ...show })),
  }));
}

function getMovies() {
  return attachShows(readDatabase());
}

function getCinemas() {
  const rows = new Map();
  for (const show of readDatabase().shows) {
    if (!rows.has(show.cinema)) {
      rows.set(show.cinema, {
        name: show.cinema,
        address: show.address,
        distance: show.distance,
        serviceTags: show.serviceTags,
      });
    }
  }
  return Array.from(rows.values());
}

function getShowsForAdmin() {
  const db = readDatabase();
  return db.shows.map((show) => {
    const movie = db.movies.find((item) => item.id === show.movieId);
    return {
      id: show.id,
      movieTitle: movie?.title || "未知影片",
      startsAt: show.startsAt,
      cinema: show.cinema,
      hall: show.hall,
      format: show.format,
      price: show.price,
      soldSeats: show.sold.length,
      totalSeats: show.seats.length,
      revenue: show.sold.length * show.price,
    };
  });
}

function getOrders() {
  return readDatabase().orders || [];
}

function addOrder(order) {
  updateDatabase((db) => {
    db.orders.push(order);
  });
}

function updateOrder(orderId, updater) {
  return updateDatabase((db) => {
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) return null;
    updater(order, db);
    return order;
  });
}

function updateShowPrice(showId, price) {
  return updateDatabase((db) => {
    const show = db.shows.find((item) => item.id === showId);
    if (!show) return null;
    show.price = price;
    return show;
  });
}

function markSeatsSold(showId, seats) {
  return updateDatabase((db) => {
    const show = db.shows.find((item) => item.id === showId);
    if (!show) return null;
    const sold = new Set(show.sold);
    for (const seat of seats) sold.add(seat);
    show.sold = Array.from(sold);
    return show;
  });
}

function findShow(showId) {
  const db = readDatabase();
  const show = db.shows.find((item) => item.id === showId);
  if (!show) return null;
  const movie = db.movies.find((item) => item.id === show.movieId);
  return { movie, show };
}

module.exports = {
  ROWS,
  COLS,
  addOrder,
  findShow,
  getCinemas,
  getMovies,
  getOrders,
  getShowsForAdmin,
  markSeatsSold,
  updateOrder,
  updateShowPrice,
};
