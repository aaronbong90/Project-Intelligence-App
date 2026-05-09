import { useState } from "react";
import type {
  AiObservationConversionDraft,
  AiObservationQueueFilter,
  AiSiteAnalysisResult,
  SmartCameraMode
} from "@/lib/ai/site-intelligence";

export type AiDailyReportDraft = {
  reportDate: string;
  location: string;
  workDone: string;
  manpowerByTrade: string;
};

export function useAiSiteIntelligenceState() {
  const [aiSiteAnalysisResult, setAiSiteAnalysisResult] = useState<AiSiteAnalysisResult | null>(null);
  const [aiSiteAnalysisError, setAiSiteAnalysisError] = useState<string | null>(null);
  const [isAiSiteAnalyzing, setIsAiSiteAnalyzing] = useState(false);
  const [aiSiteLocation, setAiSiteLocation] = useState("");
  const [aiSiteTrade, setAiSiteTrade] = useState("");
  const [smartCameraMode, setSmartCameraMode] = useState<SmartCameraMode>("defect");
  const [aiPreviousObservationId, setAiPreviousObservationId] = useState("auto");
  const [aiDailyReportDraft, setAiDailyReportDraft] = useState<AiDailyReportDraft | null>(null);
  const [aiDailyReportError, setAiDailyReportError] = useState<string | null>(null);
  const [aiDailyReportSuccess, setAiDailyReportSuccess] = useState<string | null>(null);
  const [isAiDailyReportSaving, setIsAiDailyReportSaving] = useState(false);
  const [aiObservationFilter, setAiObservationFilter] = useState<AiObservationQueueFilter>("pending");
  const [aiObservationConversionDraft, setAiObservationConversionDraft] = useState<AiObservationConversionDraft | null>(null);
  const [aiObservationActionKey, setAiObservationActionKey] = useState<string | null>(null);
  const [aiObservationQueueError, setAiObservationQueueError] = useState<string | null>(null);
  const [aiObservationQueueSuccess, setAiObservationQueueSuccess] = useState<string | null>(null);

  function resetAiAnalysisState() {
    setAiSiteAnalysisError(null);
    setAiSiteAnalysisResult(null);
    setAiDailyReportDraft(null);
    setAiDailyReportError(null);
    setAiDailyReportSuccess(null);
  }

  function resetAiQueueMessages() {
    setAiObservationQueueError(null);
    setAiObservationQueueSuccess(null);
  }

  return {
    aiSiteAnalysisResult,
    setAiSiteAnalysisResult,
    aiSiteAnalysisError,
    setAiSiteAnalysisError,
    isAiSiteAnalyzing,
    setIsAiSiteAnalyzing,
    aiSiteLocation,
    setAiSiteLocation,
    aiSiteTrade,
    setAiSiteTrade,
    smartCameraMode,
    setSmartCameraMode,
    aiPreviousObservationId,
    setAiPreviousObservationId,
    aiDailyReportDraft,
    setAiDailyReportDraft,
    aiDailyReportError,
    setAiDailyReportError,
    aiDailyReportSuccess,
    setAiDailyReportSuccess,
    isAiDailyReportSaving,
    setIsAiDailyReportSaving,
    aiObservationFilter,
    setAiObservationFilter,
    aiObservationConversionDraft,
    setAiObservationConversionDraft,
    aiObservationActionKey,
    setAiObservationActionKey,
    aiObservationQueueError,
    setAiObservationQueueError,
    aiObservationQueueSuccess,
    setAiObservationQueueSuccess,
    resetAiAnalysisState,
    resetAiQueueMessages
  };
}

