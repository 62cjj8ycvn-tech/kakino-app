import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Budget } from "../types/budget";

const budgetRef = collection(db, "budgets");

export const createBudget = async (budget: Omit<Budget, "id">) => {
console.log("送信データ", budget);
await addDoc(budgetRef, budget);
};