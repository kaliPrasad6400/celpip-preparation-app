import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import AttemptResult from "../components/AttemptResult";
import { Button, PageHeader } from "../components/ui";
import { practiceLink } from "../lib/util";

export default function AttemptPage() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => nav(-1)} className="mb-3"><ArrowLeft className="h-4 w-4" />Back</Button>
      <PageHeader title={`Attempt #${id}`} subtitle="Your saved response, scoring and feedback." />
      <AttemptResult
        attemptId={Number(id)}
        onRetry={(a) => nav(`${practiceLink(a.skill, a.question_id)}&retry=${a.id}`)}
      />
    </div>
  );
}
