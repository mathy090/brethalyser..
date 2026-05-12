/**
 * src/lib/api.ts
 *
 * Axios instance with:
 * - Auto-attach access token from memory
 * - Auto-refresh on 401 using httpOnly cookie
 * - Safe token storage (no localStorage for sensitive data)
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

// Create Axios instance
const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // ✅ Send httpOnly cookies (refreshToken) automatically
});

// ── Token management (in-memory only) ───────────────────────────────────────
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

// ── Request interceptor: attach access token ────────────────────────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// ── Response interceptor: auto-refresh on 401 ───────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Only handle 401s on API routes (not auth endpoints themselves)
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/api/auth/")
    ) {
      originalRequest._retry = true;

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      isRefreshing = true;

      try {
        // Call refresh endpoint (httpOnly cookie sent automatically)
        const { data } = await axios.post<{ accessToken: string }>(
          `${import.meta.env.VITE_BACKEND_URL}/api/auth/refresh`,
          {},
          { withCredentials: true }
        );

        // Update in-memory access token
        setAccessToken(data.accessToken);

        // Retry original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        }

        // Process queued requests
        processQueue(null, data.accessToken);

        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed → force logout
        processQueue(refreshError as AxiosError, null);
        setAccessToken(null);
        
        // Clear any residual state
        if (typeof window !== "undefined") {
          window.location.href = "/login?expired=1";
        }
        
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;