"""Schools on the site and where their course catalogs live.

`key` is the school's prefix in course codes ("unc:COMP110"), except GMU, the first
school, whose codes stay bare ("CS310"; api/src/lib/terms.js). `catalog` is the
CourseLeaf A-Z list of departments (syllabus_scraper/catalog.py reads it).
Only GMU has a syllabus archive to scrape; the others start with their catalog,
and their syllabi come from student uploads.

To add a school: add it below, then check that its A-Z page and a department page parse
(python scrape.py --catalog-only --schools <key> --departments <CODE> --dry-run),
before the weekly scrape loads it.
"""

DEFAULT_SCHOOL = "gmu"

SCHOOLS = [
    {
        "key": "gmu",
        "name": "George Mason University",
        "short": "GMU",
        "catalog": "https://catalog.gmu.edu/courses/",
    },
    {
        "key": "gatech",
        "name": "Georgia Institute of Technology",
        "short": "Georgia Tech",
        "catalog": "https://catalog.gatech.edu/coursesaz/",
    },
    {
        "key": "odu",
        "name": "Old Dominion University",
        "short": "ODU",
        "catalog": "https://catalog.odu.edu/courses/",
    },
    {
        "key": "unc",
        "name": "University of North Carolina at Chapel Hill",
        "short": "UNC",
        "catalog": "https://catalog.unc.edu/courses/",
    },
]


def school_code(school, code):
    """A bare catalog code with its school: ("unc", "COMP110") -> "unc:COMP110", GMU stays "CS310".
    Works for departments too: ("unc", "COMP") -> "unc:COMP"."""
    return code if school == DEFAULT_SCHOOL else f"{school}:{code}"
