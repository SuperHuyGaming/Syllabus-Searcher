from syllabus_scraper import rules

SYLLABUS = """MATH 113 Analytic Geometry and Calculus I, Fall 2021. George Mason University, Department of Mathematical Sciences.
Instructor: Dr. Jane Smith. Prerequisites: C or better in MATH 105 or a passing placement score. Main Course Goal: limits.
Textbook: Thomas' Calculus: Early Transcendentals (14th Edition) by Hass, Heil and Weir. MyMathLab access is required.
Grading Policy: Homework (MyMathLab) 15% Quizzes 15% Midterm Exam 1 20% Midterm Exam 2 20% Final Exam 30%.
A late penalty of 10% per day applies. Late homework is not accepted after solutions are posted.
Attendance is expected at every class meeting and recitation. Use of ChatGPT or other generative AI tools on exams is not allowed.
We use Blackboard and Gradescope; the department of Mathematical Sciences offers tutoring."""


def test_rules_find_the_main_parts():
    s = rules.summarize(SYLLABUS)
    assert s["prerequisites"] == "C or better in MATH 105 or a passing placement score"
    assert s["textbooks"] == ["Thomas' Calculus: Early Transcendentals (14th Edition) by Hass, Heil and Weir"]
    assert [row["item"] for row in s["grading"]] == [
        "Homework (MyMathLab)", "Quizzes", "Midterm Exam 1", "Midterm Exam 2", "Final Exam"]
    assert [row["weight"] for row in s["grading"]] == ["15%", "15%", "20%", "20%", "30%"]
    assert set(s["tools"]) == {"MyMathLab", "Blackboard", "Gradescope"}  # "Mathematical" isn't Mathematica
    assert s["policies"]["lateWork"].startswith("A late penalty")
    assert s["policies"]["attendance"].startswith("Attendance is expected")
    assert "ChatGPT" in s["policies"]["aiUse"]
    assert s["topics"] == [] and s["workload"] == []


def test_rules_give_nothing_for_empty_or_scanned_files():
    assert rules.summarize("") is None
    assert rules.summarize("x " * 50) is None
    assert rules.summarize("Lorem ipsum dolor sit amet. " * 20) is None


def test_weight_first_grading_lines():
    s = rules.summarize("Course grade: 40% Homework, 25% Midterm, 35% Final exam. " + "Words to fill the page. " * 20)
    assert [(r["item"], r["weight"]) for r in s["grading"]] == [("Homework", "40%"), ("Midterm", "25%"), ("Final exam", "35%")]
