"use client";

import React from "react";
import { Mascot } from "../visuals";

interface EvolutionTabProps {
  v2: any;
}

export function EvolutionTab({ v2 }: EvolutionTabProps) {
  const gens: any[] = v2.generations ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header Banner */}
      <div className="card-fintech p-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
          Autonomous Evolution &amp; Parameter Levels
        </h1>
        <p className="text-xs text-inksoft mt-0.5">
          At the conclusion of each episode, the learning system banks feedback, dynamically shifts Kelly allocation multipliers, and either unlocks higher leverage tiers or defensively claws them back.
        </p>
      </div>

      {/* Generations Timeline */}
      {gens.length === 0 ? (
        <div className="card-fintech p-12 text-center flex flex-col items-center justify-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="font-display font-semibold text-lg text-ink">No Generation Evolutions Yet</p>
          <p className="text-xs text-inksoft max-w-sm">
            Evolution level-ups are recorded when an episode finishes and the bot applies post-mortem analysis to update parameters.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {gens.map((g, i) => (
            <div key={i} className="card-fintech p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-sakura/20 text-ink font-bold flex items-center justify-center text-xs">
                      G{g.generation}
                    </span>
                    <span className="font-display font-semibold text-base text-ink">
                      Generation #{g.generation}
                    </span>
                  </div>
                  <span className="text-xs text-inksoft font-medium">
                    after run #{g.episodeNum}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-black/2 border border-white/80 grid grid-cols-2 gap-2 text-xs tnum my-3">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-inksoft">Leverage Cap</span>
                    <div className="font-bold text-ink text-sm">
                      {g.aggression?.leverageCap != null ? `${g.aggression.leverageCap}x` : "—"}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-inksoft">Kelly Fraction</span>
                    <div className="font-bold text-ink text-sm">
                      {g.aggression?.kellyFraction != null ? `${((g.aggression.kellyFraction ?? 0) * 100).toFixed(0)}%` : "—"}
                    </div>
                  </div>
                </div>

                {g.note && (
                  <p className="text-xs text-ink/90 leading-relaxed bg-white/50 p-2.5 rounded-lg border border-white/70">
                    {g.note}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default EvolutionTab;
