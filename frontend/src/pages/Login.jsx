import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import api from '../utils/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pass, setPass]   = useState('');
  const [err, setErr]     = useState('');
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      const { data } = await api.post('/auth/login', { email, password: pass });
      localStorage.setItem('mg_token', data.token);
      navigate('/');
    } catch { setErr('Invalid email or password'); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="card w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="text-indigo-400" size={26}/>
          <span className="text-xl font-bold">MailGuard</span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input className="input" type="email" placeholder="Email" value={email}
            onChange={e=>setEmail(e.target.value)} required/>
          <input className="input" type="password" placeholder="Password" value={pass}
            onChange={e=>setPass(e.target.value)} required/>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button type="submit" className="btn-primary w-full">Sign In</button>
        </form>
      </div>
    </div>
  );
}
