"use client";

import React, { useState } from "react";
import { Sakura } from "./visuals";
import { TopHeader } from "./layout/TopHeader";
import { SidebarNav } from "./layout/SidebarNav";
import { MobileNav } from "./layout/MobileNav";
import { OverviewTab } from "./tabs/OverviewTab";
import { PositionsTab } from "./tabs/PositionsTab";
import { AIAnalysisTab } from "./tabs/AIAnalysisTab";
import { TradesTab } from "./tabs/TradesTab";
import { StrategiesTab } from "./tabs/StrategiesTab";
import { EpisodesTab } from "./tabs/EpisodesTab";
import { EvolutionTab } from "./tabs/EvolutionTab";
import { WorldTab } from "./tabs/WorldTab";
import { LessonsTab } from "./tabs/LessonsTab";
import { AIDeepDiveDrawer } from "./ai/AIDeepDiveDrawer";

interface DashboardV2Props {
  data: any;
  conn?: string;
  fails?: number;
  err?: string | null;
}

export default function DashboardV2({
  data,
  conn = "live",
  fails = 0,
  err = null,
}: DashboardV2Props) {
  const [currentTab, setCurrentTab] = useState<string>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);
  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  const v2 = data?.v2 ?? {};
  const signals = v2.signals ?? null;
  const liveness = data?.liveness ?? null;
  const aiConfig = v2.ai?.config ?? null;

  const openPositionsCount = Array.isArray(signals?.positions) ? signals.positions.length : 0;
  const pendingAiCount = Array.isArray(v2.ai?.pending) ? v2.ai.pending.length : 0;

  const handleOpenCandidate = (candidate: any) => {
    setSelectedCandidate(candidate);
    setDrawerOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-cream/40 text-ink antialiased">
      {/* Background visual accents */}
      <Sakura count={14} />

      {/* 1. Global Sticky Top Header */}
      <TopHeader
        signals={signals}
        liveness={liveness}
        conn={conn}
        fails={fails}
        err={err}
        aiConfig={aiConfig}
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
      />

      {/* 2. Main Layout Container */}
      <div className="mx-auto max-w-7xl w-full flex-1 flex flex-col md:flex-row gap-6 px-4 sm:px-6 py-6">
        {/* Desktop Sidebar Navigation */}
        <SidebarNav
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setCurrentTab(tab);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          openPositionsCount={openPositionsCount}
          pendingAiCount={pendingAiCount}
        />

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 flex flex-col gap-5">
          {/* Mobile Navigation Pills */}
          <MobileNav
            currentTab={currentTab}
            onSelectTab={(tab) => {
              setCurrentTab(tab);
              setMobileNavOpen(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            openPositionsCount={openPositionsCount}
            pendingAiCount={pendingAiCount}
          />

          {/* Tab Views */}
          {currentTab === "overview" && (
            <OverviewTab
              v2={v2}
              s={signals}
              onNavigateToTab={setCurrentTab}
              onSelectCandidate={handleOpenCandidate}
            />
          )}

          {currentTab === "positions" && (
            <PositionsTab
              s={signals}
              onSelectCandidate={handleOpenCandidate}
              onNavigateToAI={() => setCurrentTab("ai")}
            />
          )}

          {currentTab === "ai" && (
            <AIAnalysisTab v2={v2} />
          )}

          {currentTab === "trades" && (
            <TradesTab
              v2={v2}
              onSelectCandidate={handleOpenCandidate}
              onNavigateToAI={() => setCurrentTab("ai")}
            />
          )}

          {currentTab === "strategies" && (
            <StrategiesTab v2={v2} />
          )}

          {currentTab === "episodes" && (
            <EpisodesTab v2={v2} s={signals} />
          )}

          {currentTab === "evolution" && (
            <EvolutionTab v2={v2} />
          )}

          {currentTab === "world" && (
            <WorldTab s={signals} />
          )}

          {currentTab === "lessons" && (
            <LessonsTab v2={v2} />
          )}
        </main>
      </div>

      {/* Global Slide-Over Drawer for Candidates selected across any tab */}
      <AIDeepDiveDrawer
        candidate={selectedCandidate}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
