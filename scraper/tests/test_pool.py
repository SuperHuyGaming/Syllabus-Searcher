from syllabus_scraper.pool import MB, Pool, pool_uris


def test_pool_uris_main_first_then_numbered():
    env = {"MONGODB_URI": "main", "MONGODB_URI_10": "ten", "MONGODB_URI_2": "two", "MONGODB_URI_3": " ", "OTHER": "x"}
    assert pool_uris(env) == ["main", "two", "ten"]
    assert pool_uris({}) == ["mongodb://localhost:27017"]


class FakeBucket:
    def __init__(self):
        self.files = []

    def upload_from_stream(self, filename, data, metadata=None):
        self.files.append(filename)
        return f"{len(self.files):024x}"


class FakeMember:
    def __init__(self, name, cluster_mb, db_mb):
        self.name = name
        self.bucket = FakeBucket()
        self.sizes = (cluster_mb * MB, db_mb * MB)

    def cluster_bytes(self):
        return self.sizes[0]

    def db_bytes(self):
        return self.sizes[1]


def test_files_go_to_the_first_cluster_with_room():
    main, second = FakeMember("1", 469, 100), FakeMember("2", 10, 0)
    pool = Pool([main, second], cap=470 * MB)
    assert pool.save(b"x" * 1000, "a.pdf", {}) is not None
    assert main.bucket.files == ["a.pdf"]
    # Main fills up; the next file goes to the second cluster.
    pool.save(b"x" * (MB // 2), "b.pdf", {})
    pool.save(b"x" * (MB // 2), "c.pdf", {})
    assert main.bucket.files == ["a.pdf", "b.pdf"] and second.bucket.files == ["c.pdf"]


def test_budget_keeps_a_site_to_a_sample_and_full_pool_returns_none():
    staging = FakeMember("1", 100, 49.9)
    pool = Pool([staging], cap=470 * MB, budget=50 * MB)
    assert pool.save(b"x" * 1000, "a.pdf", {}) is not None
    assert pool.save(b"x" * MB, "b.pdf", {}) is None
    assert any("budget 50 MB" in line for line in pool.report())
