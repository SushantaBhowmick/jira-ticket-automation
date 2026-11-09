"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DatePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-11 w-full items-center justify-between rounded-xl border border-[#d7cbb8] bg-white px-3 text-left text-sm outline-none hover:border-[#0f5f5a] focus:border-[#0f5f5a] disabled:opacity-60"
        >
          <span className={selected ? "font-medium" : "text-[#8a7d6b]"}>
            {selected ? formatDisplay(selected) : "Choose a date"}
          </span>
          <CalendarDays className="size-4 text-[#0f5f5a]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-[70] w-auto rounded-2xl border border-[#e4d9c8] bg-[#fffdf8] p-3 shadow-[0_16px_40px_rgba(28,25,21,0.16)]"
        >
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (!date) return;
              onChange(toIso(date));
              setOpen(false);
            }}
            showOutsideDays
            classNames={{
              root: "text-[#1c1915]",
              months: "flex flex-col",
              month: "space-y-3",
              month_caption: "relative flex h-9 items-center justify-center",
              caption_label: "text-sm font-semibold",
              nav: "absolute inset-x-0 top-0 flex items-center justify-between",
              button_previous: navButton,
              button_next: navButton,
              chevron: "size-4 fill-[#0f5f5a]",
              month_grid: "w-full border-separate border-spacing-y-1",
              weekdays: "flex",
              weekday: "w-9 text-center text-[11px] font-medium tracking-wide text-[#8a7d6b] uppercase",
              week: "mt-1 flex",
              day: "p-0 text-center",
              day_button: cn(
                "inline-flex size-9 items-center justify-center rounded-full text-sm hover:bg-[#e7f3f1]",
              ),
              selected: "[&>button]:bg-[#0f5f5a] [&>button]:text-white [&>button]:hover:bg-[#0c4c48]",
              today: "[&>button]:ring-1 [&>button]:ring-[#0f5f5a]",
              outside: "text-[#b3a898]",
              disabled: "opacity-40",
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const navButton =
  "inline-flex size-8 items-center justify-center rounded-full text-[#0f5f5a] hover:bg-[#e7f3f1]";

function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDisplay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
