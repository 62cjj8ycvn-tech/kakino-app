import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../firebase";

export const signup = async (email: string, password: string) => {
await createUserWithEmailAndPassword(auth, email, password);
};

export const login = async (email: string, password: string) => {
await signInWithEmailAndPassword(auth, email, password);
};

export const logout = async () => {
await signOut(auth);
};
