import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as date from "./date";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
};

export { date };
