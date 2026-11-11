import { Route, Routes, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Explorer from "./pages/Explorer.jsx";
import ProjectPage from "./pages/ProjectPage.jsx";
import Register from "./pages/Register.jsx";
import Marketplace from "./pages/Marketplace.jsx";
import Portfolio from "./pages/Portfolio.jsx";

export default function App() {
  const { pathname } = useLocation();
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <ErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<Explorer />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/register" element={<Register />} />
          <Route path="/market" element={<Marketplace />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="*" element={<div className="page"><h1>Page not found</h1></div>} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
