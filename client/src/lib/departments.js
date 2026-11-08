import { DEFAULT_SCHOOL, deptKey } from './courses';

// Departments with syllabi first, then the rest, each A to Z.
export function sortDepartments(departments) {
  return [...departments].sort(
    (a, b) => Number(b.withSyllabi > 0) - Number(a.withSyllabi > 0) || a.name.localeCompare(b.name)
  );
}

// Codes computer science goes by at different schools, most likely first.
const COMPUTER_SCIENCE = ['CS', 'COMP', 'CSC', 'CSCI', 'CMSC', 'CSE'];

// The department the home page lists: the one in the address, else GMU's CS, else the
// school's department with the most syllabi, else its computer science, else the first.
// Null while another school's departments are still loading.
export function pickDepartment(departments, school, wanted) {
  if (wanted) return deptKey(wanted, school);
  if (school === DEFAULT_SCHOOL) return 'CS';
  if (!departments.length) return null;
  const busiest = [...departments].sort((a, b) => b.withSyllabi - a.withSyllabi)[0];
  if (busiest.withSyllabi > 0) return busiest.code;
  // In the list's order, so Georgia Tech's CS wins over its CSE ("Computational Science").
  const cs = COMPUTER_SCIENCE.map((code) => departments.find((d) => d.display === code)).find(Boolean);
  return (cs || departments[0]).code;
}
