import axios from "axios";
import type { GraphRequest, GraphResponse } from "../types/graph";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"
});

export async function fetchRepositoryGraph(payload: GraphRequest): Promise<GraphResponse> {
  const { data } = await api.post<GraphResponse>("/api/graph", payload);
  return data;
}

