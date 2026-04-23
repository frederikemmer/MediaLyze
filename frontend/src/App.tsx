import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { AppDataProvider } from "./lib/app-data";
import { ScanJobsProvider } from "./lib/scan-jobs";
import { ThemeProvider } from "./lib/theme";
import { DashboardPage } from "./pages/DashboardPage";
import { FileDetailPage } from "./pages/FileDetailPage";
import { LibrariesPage } from "./pages/LibrariesPage";
import { LibraryDetailPage } from "./pages/LibraryDetailPage";
import { SeriesDetailPage } from "./pages/SeriesDetailPage";

export function App() {
  return (
    <ThemeProvider>
      <ScanJobsProvider>
        <AppDataProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/settings" element={<LibrariesPage />} />
              <Route path="/libraries/:libraryId/series/:seriesId" element={<SeriesDetailPage />} />
              <Route path="/libraries/:libraryId" element={<LibraryDetailPage />} />
              <Route path="/files/:fileId" element={<FileDetailPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AppDataProvider>
      </ScanJobsProvider>
    </ThemeProvider>
  );
}
