import type {
  CandidateDetailResponse,
  CandidateListRow,
  GenerateAssignmentInput,
} from "@/lib/types";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function listCandidates(): Promise<CandidateListRow[]> {
  const body = await apiFetch<{ candidates: CandidateListRow[] }>("/api/company/candidates", {
    cache: "no-store",
  });
  return body.candidates;
}

export async function createCandidate(input: {
  name: string;
  designation: string;
  githubRepo?: string;
}): Promise<void> {
  await apiFetch("/api/company/candidates", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getCandidateDetail(candidateId: string): Promise<CandidateDetailResponse> {
  return apiFetch<CandidateDetailResponse>(`/api/company/candidates/${candidateId}`, {
    cache: "no-store",
  });
}

export async function generateAssignment(
  candidateId: string,
  input: GenerateAssignmentInput,
): Promise<void> {
  await apiFetch(`/api/company/candidates/${candidateId}/assignments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}
