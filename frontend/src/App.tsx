import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { HostPage } from './pages/HostPage';
import { JoinPage } from './pages/JoinPage';
import { DisplayPage } from './pages/DisplayPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/host/:sessionId" element={<HostPage />} />
        <Route path="/join/:sessionId" element={<JoinPage />} />
        <Route path="/display/:sessionId" element={<DisplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
