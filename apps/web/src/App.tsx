/**
 * @nexora/app-web — application routes.
 *
 * The onboarding flow (FRONTEND.md §3 information architecture): Landing →
 * Login (SSO) → Organization wizard → Workspace wizard → Dashboard.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Landing } from './pages/Landing.js';
import { Login } from './pages/Login.js';
import { OrganizationWizard } from './pages/onboarding/OrganizationWizard.js';
import { WorkspaceWizard } from './pages/onboarding/WorkspaceWizard.js';
import { Dashboard } from './pages/Dashboard.js';
import { Documents } from './pages/Documents.js';
import { Knowledge } from './pages/Knowledge.js';
import { Employees } from './pages/Employees.js';
import { Projects } from './pages/Projects.js';
import { Workflows } from './pages/Workflows.js';
import { RequireAuth, SessionProvider } from './session.js';

/** The application root. */
export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/onboarding/organization"
            element={
              <RequireAuth>
                <OrganizationWizard />
              </RequireAuth>
            }
          />
          <Route
            path="/onboarding/workspace"
            element={
              <RequireAuth>
                <WorkspaceWizard />
              </RequireAuth>
            }
          />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/app/projects"
            element={
              <RequireAuth>
                <Projects />
              </RequireAuth>
            }
          />
          <Route
            path="/app/employees"
            element={
              <RequireAuth>
                <Employees />
              </RequireAuth>
            }
          />
          <Route
            path="/app/documents"
            element={
              <RequireAuth>
                <Documents />
              </RequireAuth>
            }
          />
          <Route
            path="/app/knowledge"
            element={
              <RequireAuth>
                <Knowledge />
              </RequireAuth>
            }
          />
          <Route
            path="/app/workflows"
            element={
              <RequireAuth>
                <Workflows />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
