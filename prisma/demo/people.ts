/**
 * Demo participants. Names are invented; every row is written with isDemo=true
 * so `make db-clear-demo` can delete exactly this set and nothing else.
 *
 * All of them share one password, printed by the seed, because the point of the
 * demo data is that you can log in as anyone and look at their portfolio.
 */
export interface DemoPerson {
  firstName: string;
  lastName: string;
  department: string;
}

export const DEMO_PASSWORD = "demo1234";

export const DEMO_PEOPLE: DemoPerson[] = [
  { firstName: "Sarah", lastName: "Weber", department: "Engineering" },
  { firstName: "Thomas", lastName: "Bakker", department: "Sales" },
  { firstName: "Emma", lastName: "Lindqvist", department: "Finance" },
  { firstName: "Lucas", lastName: "Moreau", department: "Engineering" },
  { firstName: "Aisha", lastName: "Rahman", department: "Product" },
  { firstName: "Marco", lastName: "Rossi", department: "Operations" },
  { firstName: "Nina", lastName: "Kowalski", department: "Marketing" },
  { firstName: "Daniel", lastName: "Fischer", department: "Engineering" },
  { firstName: "Sofia", lastName: "Almeida", department: "Legal" },
  { firstName: "Jonas", lastName: "Hansen", department: "Finance" },
  { firstName: "Priya", lastName: "Nair", department: "Product" },
  { firstName: "Karel", lastName: "Novák", department: "Operations" },
  { firstName: "Elena", lastName: "Petrova", department: "Marketing" },
  { firstName: "Mateo", lastName: "García", department: "Sales" },
  { firstName: "Hannah", lastName: "Schmidt", department: "People" },
  { firstName: "Yusuf", lastName: "Demir", department: "Engineering" },
  { firstName: "Clara", lastName: "Dubois", department: "Finance" },
  { firstName: "Oliver", lastName: "Murphy", department: "Sales" },
  { firstName: "Ingrid", lastName: "Johansson", department: "Product" },
  { firstName: "Rafael", lastName: "Silva", department: "Engineering" },
  { firstName: "Amara", lastName: "Okafor", department: "Legal" },
  { firstName: "Felix", lastName: "Wagner", department: "Operations" },
  { firstName: "Maja", lastName: "Horvat", department: "Marketing" },
  { firstName: "Sebastian", lastName: "Larsen", department: "Finance" },
  { firstName: "Leila", lastName: "Haddad", department: "Product" },
  { firstName: "Viktor", lastName: "Melnyk", department: "Engineering" },
  { firstName: "Chiara", lastName: "Conti", department: "Sales" },
  { firstName: "Pieter", lastName: "de Vries", department: "Operations" },
];
