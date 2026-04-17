import { $fetch } from 'ofetch'

export const DEFAULT_URL = 'https://app.shelve.cloud'

export interface ShelveUser { username: string, email: string }
export interface ShelveTeam { slug: string, name: string }
export interface ShelveProject { id: number, name: string }
export interface ShelveEnvironment { id: number, name: string }
export interface ShelveVariable { key: string, value: string }

export interface ShelveClient {
  getMe: () => Promise<ShelveUser>
  getTeams: () => Promise<ShelveTeam[]>
  getProjects: (slug: string) => Promise<ShelveProject[]>
  getProjectByName: (slug: string, project: string) => Promise<ShelveProject>
  getEnvironment: (slug: string, env: string) => Promise<ShelveEnvironment>
  getVariables: (slug: string, projectId: number, envId: number) => Promise<ShelveVariable[]>
}

export function createShelveClient({ token, url = DEFAULT_URL }: { token: string, url?: string }): ShelveClient {
  const base = url.replace(/\/+$/, '')
  const headers = { Cookie: `authToken=${token}` }
  const get = <T>(path: string): Promise<T> => $fetch<T>(`${base}${path}`, { headers })

  return {
    getMe: () => get<ShelveUser>('/api/user/me'),
    getTeams: () => get<ShelveTeam[]>('/api/teams'),
    getProjects: slug => get<ShelveProject[]>(`/api/teams/${slug}/projects`),
    getProjectByName: (slug, project) => get<ShelveProject>(`/api/teams/${slug}/projects/name/${encodeURIComponent(project)}`),
    getEnvironment: (slug, env) => get<ShelveEnvironment>(`/api/teams/${slug}/environments/${env}`),
    getVariables: (slug, projectId, envId) => get<ShelveVariable[]>(`/api/teams/${slug}/projects/${projectId}/variables/env/${envId}`),
  }
}
