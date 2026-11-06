import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('mg_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    // Only redirect to login on 401 if this wasn't the login request itself
    if (
      err.response?.status === 401 &&
      !err.config?.url?.includes('/auth/login')
    ) {
      localStorage.removeItem('mg_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;