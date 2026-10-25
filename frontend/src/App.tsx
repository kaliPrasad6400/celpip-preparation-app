import { Route, Routes } from "react-router-dom";
import Layout, { NotFound } from "./components/Layout";
import AnalyticsPage from "./pages/Analytics";
import AttemptPage from "./pages/Attempt";
import CanadaPage from "./pages/Canada";
import Dashboard from "./pages/Dashboard";
import ListeningPage from "./pages/Listening";
import MistakesPage from "./pages/Mistakes";
import MockPage from "./pages/Mock";
import NewsPage from "./pages/News";
import NotesPage from "./pages/Notes";
import PracticeHub from "./pages/Practice";
import ReadingPage from "./pages/Reading";
import SettingsPage from "./pages/Settings";
import SpeakingPage from "./pages/Speaking";
import TemplatesPage from "./pages/Templates";
import TodayPage from "./pages/Today";
import VocabularyPage from "./pages/Vocabulary";
import WritingPage from "./pages/Writing";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="practice" element={<PracticeHub />} />
        <Route path="speaking" element={<SpeakingPage />} />
        <Route path="writing" element={<WritingPage />} />
        <Route path="listening" element={<ListeningPage />} />
        <Route path="reading" element={<ReadingPage />} />
        <Route path="attempts/:id" element={<AttemptPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/:id" element={<TemplatesPage />} />
        <Route path="vocabulary" element={<VocabularyPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="notes/:id" element={<NotesPage />} />
        <Route path="mistakes" element={<MistakesPage />} />
        <Route path="canada" element={<CanadaPage />} />
        <Route path="canada/:id" element={<CanadaPage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="news/:id" element={<NewsPage />} />
        <Route path="mock" element={<MockPage />} />
        <Route path="mock/:id" element={<MockPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
