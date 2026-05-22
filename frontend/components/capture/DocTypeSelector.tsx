"use client";

import { CreditCard, BookOpen, FileText, Car } from "lucide-react";
import type { DocumentType } from "@/lib/verification";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_REQUIRES_BACK } from "@/lib/verification";

const ICONS: Record<DocumentType, React.ElementType> = {
  national_id: CreditCard,
  passport: BookOpen,
  residence_permit: FileText,
  drivers_license: Car,
};

const DOC_TYPES: DocumentType[] = [
  "national_id",
  "passport",
  "residence_permit",
  "drivers_license",
];

interface Props {
  onSelect: (type: DocumentType) => void;
  error?: string;
}

export function DocTypeSelector({ onSelect, error }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <h2 className="text-xl font-semibold text-zinc-900 mb-1">Select Document Type</h2>
      <p className="text-zinc-500 text-sm mb-6">
        Choose the document you will use to verify your identity
      </p>

      {error && (
        <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {DOC_TYPES.map((type) => {
          const Icon = ICONS[type];
          return (
            <button
              key={type}
              onClick={() => onSelect(type)}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-zinc-100 hover:border-zinc-900 hover:bg-zinc-50 transition-all text-center group cursor-pointer"
            >
              <Icon className="w-8 h-8 text-zinc-400 group-hover:text-zinc-900 transition-colors" />
              <div>
                <p className="font-medium text-zinc-700 text-sm group-hover:text-zinc-900 transition-colors">
                  {DOCUMENT_TYPE_LABELS[type]}
                </p>
                {DOCUMENT_REQUIRES_BACK[type] && (
                  <p className="text-xs text-zinc-400 mt-0.5">Front + Back</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
