"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { buildContributionCalendar, getContributionYears, type ContributionItem } from "../lib/contribution-heatmap";
import styles from "../app/site.module.css";

const weekdayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

function formatDay(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
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
              {week.map((day, dayIndex) => day ? <span
                className={styles.contributionCell}
                data-contribution-cell
                data-level={day.level}
                key={day.date}
                role="img"
                aria-label={`${day.count} ${day.count === 1 ? "update" : "updates"} on ${formatDay(day.date)}`}
                title={`${day.count} ${day.count === 1 ? "update" : "updates"} on ${formatDay(day.date)}`}
              /> : <span className={styles.contributionCellOutside} aria-hidden="true" key={`${year}-outside-${weekIndex}-${dayIndex}`} />)}
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
