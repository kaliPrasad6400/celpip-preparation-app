import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObjectiveReview, RubricEvaluation } from "../components/EvaluationView";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const ev = {
  id: 1, kind: "ai_rubric", estimated_level: 9, confidence: "medium", estimated_level_range: "8-10", model: "claude-opus-5-5",
  created_at: "2026-10-21T10:00:00", summary: "Solid response.", limitations: "Text-only evaluation: pronunciation not assessed.",
  criteria: [{ id: 1, name: "Task fulfillment", assessed: true, level: 9, strengths: "Clear", weaknesses: "Thin", examples: [], improvements: "Add detail" },
             { id: 2, name: "Pronunciation, pace and fluency", assessed: false, level: null, strengths: "", weaknesses: "", examples: [], improvements: "" }],
  corrections: [{ original: "I need new key.", corrected: "I need a new key.", explanation: "Article", natural_alternative: "I need a replacement key.", category: "grammar" }],
  vocabulary_suggestions: [{ original: "fix", suggestion: "resolve", meaning: "settle", example: "", collocations: [] }],
  improved_response: "Improved text", comparison: [{ aspect: "Tone", mine: "abrupt", improved: "polite", why_it_matters: "" }],
  next_steps: ["Check articles"], retry_exercise: "Rewrite paragraph 2.",
};

describe("RubricEvaluation", () => {
  it("labels the level as an unofficial estimate and shows limitations", () => {
    wrap(<RubricEvaluation ev={ev} attempt={{ skill: "speaking", response_text: "my answer", transcript: null }} />);
    expect(screen.getByText("≈ Level 9")).toBeInTheDocument();
    expect(screen.getByText("Unofficial AI estimate")).toBeInTheDocument();
    expect(screen.getByText(/not an official CELPIP score/i)).toBeInTheDocument();
    expect(screen.getByText(/pronunciation not assessed/i)).toBeInTheDocument();
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
    expect(screen.getByText("I need a new key.")).toBeInTheDocument();
  });
});

describe("ObjectiveReview", () => {
  it("shows the objective score and marks the missed item", () => {
    const attempt = {
      score_correct: 1, score_total: 2, accuracy: 0.5, answers: { q1: 0, q2: 2 },
      evaluations: [{ kind: "objective", limitations: "Calculated against this app's answer key." }],
      question: { items: [
        { id: "q1", stem: "First?", options: ["a", "b", "c", "d"], answer: 0, explanation: "Because a.", qtype: "detail" },
        { id: "q2", stem: "Second?", options: ["a", "b", "c", "d"], answer: 1, explanation: "Because b.", qtype: "inference" },
      ] },
    };
    wrap(<ObjectiveReview attempt={attempt} onExplain={() => {}} />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText(/objective practice accuracy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Explain my mistakes/ })).toBeInTheDocument();
  });
});
