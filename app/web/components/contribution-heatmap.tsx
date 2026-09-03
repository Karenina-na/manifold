"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { buildContributionCalendar, getContributionYears, type ContributionDay, type ContributionItem } from "../lib/contribution-heatmap";
import { FloatingTooltip } from "./floating-tooltip";
import { formatDate } from "../lib/api";
import styles from "../app/site.module.css";

const weekdayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

function formatDay(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function ContributionCell({ day }: { day: ContributionDay }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number>(0);
  const interactive = day.updates.length > 0;
  const label = `${day.count} ${day.count === 1 ? "update" : "updates"} on ${formatDay(day.date)}`;

  const cancelTimer = () => window.clearTimeout(hoverTimer.current);
  const openTooltip = () => { cancelTimer(); setOpen(true); };
  const closeTooltip = () => { cancelTimer(); hoverTimer.current = window.setTimeout(() => setOpen(false), 120); };

  if (!interactive) {
    return <span
      role="img"
      aria-label={label}
      title={label}
      data-contribution-cell
      data-level={day.level}
      className={styles.contributionCell}
    />;
  }

  return <span
    ref={anchorRef}
    role="img"
    aria-label={label}
    tabIndex={0}
    data-contribution-cell
    data-contribution-interactive="true"
    data-level={day.level}
    className={styles.contributionCell}
    onMouseEnter={openTooltip}
    onMouseLeave={closeTooltip}
    onFocus={openTooltip}
    onBlur={closeTooltip}
  >
    <FloatingTooltip anchorRef={anchorRef} open={open} placement="top" dataAttribute="data-contribution-tooltip" interactive onMouseEnter={openTooltip} onMouseLeave={closeTooltip}>
      <span className={styles.tooltipMeta}>{formatDay(day.date)} · {day.count} {day.count === 1 ? "update" : "updates"}</span>
      <span className={styles.updatePreviewList}>
        {day.updates.map((entry) => <Link className={styles.updatePreviewItem} href={entry.href} key={entry.id} tabIndex={open ? 0 : -1}>
          <span className={styles.updatePreviewItemMeta}>{entry.kind === "ARTICLE" ? "WRITING" : "THOUGHT"} · {formatDate(entry.date)}</span>
          <strong>{entry.title}</strong>
          <span>{entry.summary}</span>
        </Link>)}
      </span>
    </FloatingTooltip>
  </span>;
}

export function ContributionHeatmap({ items }: { items: ContributionItem[] }) {
  const years = useMemo(() => getContributionYears(items), [items]);
  const fallbackYear = new Date().getUTCFullYear();
  const availableYears = [...new Set([fallbackYear, ...years])].sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(availableYears[0]);
  const year = availableYears.includes(selectedYear) ? selectedYear : availableYears[0];
  const calendar = buildContributionCalendar(items, year);
  const monthDenominator = Math.max(1, calendar.weeks.length - 1);

  return <div className={styles.contributionHeatmap} data-contribution-heatmap>
    <div className={styles.contributionHeader}>
      <div className={styles.contributionHeading}>
        <span className={styles.contributionKicker}><CalendarDays size={12} aria-hidden="true" /> ACTIVITY</span>
        <h3>Contribution activity</h3>
      </div>
      <label className={styles.contributionYear}>
        <span>Year</span>
        <span className={styles.contributionSelectWrap}>
          <select value={year} onChange={(event) => setSelectedYear(Number(event.target.value))} aria-label="Contribution year" data-contribution-year>
            {availableYears.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </span>
      </label>
    </div>
    <div className={styles.contributionSummary}><strong>{calendar.total}</strong> updates in {year}</div>
    <div className={styles.contributionScroll}>
      <div className={styles.contributionCanvas} style={{ "--contribution-weeks": calendar.weeks.length } as CSSProperties}>
        <div className={styles.contributionMonths} aria-hidden="true">
          {calendar.months.map((month) => <span key={`${year}-${month.label}`} data-contribution-month style={{ left: `${(month.week / monthDenominator) * 100}%` }}>{month.label}</span>)}
        </div>
        <div className={styles.contributionBody}>
          <div className={styles.contributionWeekdays} aria-hidden="true">{weekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
          <div className={styles.contributionGrid}>
            {calendar.weeks.map((week, weekIndex) => <div className={styles.contributionWeek} key={`${year}-week-${weekIndex}`}>
              {week.map((day, dayIndex) => day ? <ContributionCell key={day.date} day={day} /> : <span className={styles.contributionCellOutside} aria-hidden="true" key={`${year}-outside-${weekIndex}-${dayIndex}`} />)}
            </div>)}
          </div>
        </div>
      </div>
    </div>
    <div className={styles.contributionFooter}>
      <span>Less</span>
      <span className={styles.contributionLegend} aria-hidden="true">{[0, 1, 2, 3, 4].map((level) => <span className={styles.contributionCell} data-level={level} key={level} />)}</span>
      <span>More</span>
    </div>
  </div>;
}
