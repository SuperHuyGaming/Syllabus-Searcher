import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Course from './pages/Course';
import Upload from './pages/Upload';
import NotFound from './pages/NotFound';

// Only admins load the Supabase auth code.
const Admin = lazy(() => import('./pages/Admin'));

export default function App() {
  return (
    <Suspense>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="courses/:code" element={<Course />} />
          <Route path="upload" element={<Upload />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
