from flask import Flask, jsonify, request
from prometheus_client import Counter, generate_latest

app = Flask(__name__)
recommend_counter = Counter("cinema_recommend_requests_total", "Recommendation requests")

MOVIES = [
    {"title": "星际回声", "score": 9.3, "tags": ["科幻", "IMAX", "热映"]},
    {"title": "午夜列车", "score": 8.8, "tags": ["悬疑", "新片", "黄金场"]},
    {"title": "海边来信", "score": 9.1, "tags": ["爱情", "高分", "VIP厅"]},
    {"title": "云端漫游指南", "score": 8.9, "tags": ["亲子", "动画", "低价场"]},
]


@app.get("/health")
def health():
    return jsonify({"status": "UP", "service": "Hybrid Flask recommender"})


@app.get("/recommend")
def recommend():
    recommend_counter.inc()
    keyword = request.args.get("keyword", "").strip()
    rows = sorted(MOVIES, key=lambda item: item["score"], reverse=True)
    if keyword:
        rows = [item for item in rows if keyword in item["title"] or keyword in "".join(item["tags"])]
    return jsonify({"engine": "Hybrid Flask", "keyword": keyword, "movies": rows[:3]})


@app.get("/metrics")
def metrics():
    return generate_latest(), 200, {"Content-Type": "text/plain; version=0.0.4"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
