/**
 * @nexora/app-web — application routes.
 *
 * The onboarding flow (FRONTEND.md §3 information architecture): Landing →
 * identity provider (Keycloak SSO, via `/api/auth/login` — no in-app
 * sign-in screen) → Organization wizard → Workspace wizard → Dashboard.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Landing } from './pages/Landing.js';
import { OrganizationWizard } from './pages/onboarding/OrganizationWizard.js';
import { WorkspaceWizard } from './pages/onboarding/WorkspaceWizard.js';
import { Dashboard } from './pages/Dashboard.js';
import { Documents } from './pages/Documents.js';
import { Knowledge } from './pages/Knowledge.js';
import { Apps } from './pages/Apps.js';
import { Employees } from './pages/Employees.js';
import { Hiring } from './pages/Hiring.js';
import { Recruiting } from './pages/Recruiting.js';
import { Integrations } from './pages/Integrations.js';
import { Insights } from './pages/Insights.js';
import { Agent } from './pages/Agent.js';
import { Agents } from './pages/Agents.js';
import { Assistant } from './pages/Assistant.js';
import { Settings } from './pages/Settings.js';
import { Problems } from './pages/Problems.js';
import { CommandCenter } from './pages/CommandCenter.js';
import { Projects } from './pages/Projects.js';
import { Workflows } from './pages/Workflows.js';
import { Calendar } from './pages/Calendar.js';
import { Finance } from './pages/Finance.js';
import { Audit } from './pages/Audit.js';
import { Runtime } from './pages/Runtime.js';
import { Policy } from './pages/Policy.js';
import { Approvals } from './pages/Approvals.js';
import { DemoStart } from './pages/DemoStart.js';
import { GuidedDemo } from './pages/GuidedDemo.js';
import { DemoProvider } from './demo/DemoProvider.js';
import { RequireAuth, SessionProvider } from './session.js';

/** The application root. */
export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <SessionProvider>
        <DemoProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/demo" element={<DemoStart />} />
            <Route
              path="/app/demo"
              element={
                <RequireAuth>
                  <GuidedDemo />
                </RequireAuth>
              }
            />
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
              path="/app/command-center"
              element={
                <RequireAuth>
                  <CommandCenter />
                </RequireAuth>
              }
            />
            <Route
              path="/app/agent"
              element={
                <RequireAuth>
                  <Agent />
                </RequireAuth>
              }
            />
            <Route
              path="/app/agents"
              element={
                <RequireAuth>
                  <Agents />
                </RequireAuth>
              }
            />
            <Route
              path="/app/problems"
              element={
                <RequireAuth>
                  <Problems />
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
              path="/app/hiring"
              element={
                <RequireAuth>
                  <Hiring />
                </RequireAuth>
              }
            />
            <Route
              path="/app/recruiting"
              element={
                <RequireAuth>
                  <Recruiting />
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
              path="/app/apps"
              element={
                <RequireAuth>
                  <Apps />
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
            <Route
              path="/app/calendar"
              element={
                <RequireAuth>
                  <Calendar />
                </RequireAuth>
              }
            />
            <Route
              path="/app/finance"
              element={
                <RequireAuth>
                  <Finance />
                </RequireAuth>
              }
            />
            <Route
              path="/app/audit"
              element={
                <RequireAuth>
                  <Audit />
                </RequireAuth>
              }
            />
            <Route
              path="/app/runtime"
              element={
                <RequireAuth>
                  <Runtime />
                </RequireAuth>
              }
            />
            <Route
              path="/app/policy"
              element={
                <RequireAuth>
                  <Policy />
                </RequireAuth>
              }
            />
            <Route
              path="/app/approvals"
              element={
                <RequireAuth>
                  <Approvals />
                </RequireAuth>
              }
            />
            <Route
              path="/app/integrations"
              element={
                <RequireAuth>
                  <Integrations />
                </RequireAuth>
              }
            />
            <Route
              path="/app/insights"
              element={
                <RequireAuth>
                  <Insights />
                </RequireAuth>
              }
            />
            <Route
              path="/app/assistant"
              element={
                <RequireAuth>
                  <Assistant />
                </RequireAuth>
              }
            />
            <Route
              path="/app/settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </DemoProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
