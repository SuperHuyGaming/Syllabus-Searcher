from syllabus_scraper.names import full_name, needs_full_name


def test_fills_in_a_first_name_from_an_initial():
    text = "CS 584 Data Mining Instructor: Ziwei Zhu Email: zzhu20@gmu.edu"
    assert full_name("Zhu, Z", text) == "Zhu, Ziwei"


def test_bare_surname_picks_up_a_second_surname_glued_to_the_email():
    text = ("Instructors: Instructor Name Email Office Prof. David I. Gonzalez Samudiodgonza10@gmu.eduBuchanan Hall "
            "D215F Dr. Brian Hrolenok hrolenok@gmu.edu")
    assert full_name("Gonzalez", text) == "Gonzalez Samudio, David"
    assert full_name("Hrolenok", text) == "Hrolenok, Brian"


def test_initial_must_match():
    assert full_name("Chen, S", "Professor Jim Chen teaches this") is None
    assert full_name("Chen, J", "Professor Jim Chen teaches this") == "Chen, Jim"


def test_ignores_words_that_are_not_names():
    assert full_name("Plaku, E", "Erion Plaku Contents 1 Overview") == "Plaku, Erion"
    assert full_name("Kamranfar", "Office Hours Kamranfar Dates TBD. Instructor: Parastoo Kamranfar") == "Kamranfar, Parastoo"


def test_returns_none_when_the_name_is_not_spelled_out():
    assert full_name("Yin", "Lectures are on Tuesdays") is None
    assert full_name("Yin", "Office: ENGR 4300 Yin") is None


def test_which_names_need_a_first_name():
    assert needs_full_name("Zhu, Z")
    assert needs_full_name("Gonzalez")
    assert not needs_full_name("Zhu, Ziwei")
    assert not needs_full_name("All Instructors")


def test_listing_without_accents_matches_accented_name():
    text = "Sections: DL1, DL2 Instructor: Ana Loreto González Hernández Email: loreto@gmu.edu"
    assert full_name("Gonzalez", text) == "González Hernández, Ana"
    assert full_name("González, A", text) == "González, Ana"
