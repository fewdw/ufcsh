import { useState, type RefObject } from "react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { DateField, DateInput, DateSegment } from "react-aria-components/DateField";
import { Button } from "react-aria-components/Button";
import { Label } from "react-aria-components/Label";
import { FieldError } from "react-aria-components/FieldError";
import { Popover } from "react-aria-components/Popover";
import { Dialog } from "react-aria-components/Dialog";
import { Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, CalendarHeading, CalendarMonthPicker, CalendarYearPicker } from "react-aria-components/Calendar";
import { ChevronLeft, ChevronRight } from "lucide-react";

const earliest = parseDate("2013-02-04");
const calendarButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100 disabled:opacity-30";
const calendarSelect = "h-11 min-w-0 rounded-lg border border-zinc-200 bg-white pl-2 pr-6 text-sm font-medium text-zinc-900";

function initialDate(date: string | null) {
  try { return date ? parseDate(date) : null; } catch { return null; }
}

/** Date drafts are applied only by View; Reset returns to today's rankings. */
export default function RankingsDatePicker({ selectedDate, today, onView, triggerRef, onClose }: {
  selectedDate: string | null; today: string; onView: (date: string | null) => void;
  triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  const [value, setValue] = useState<CalendarDate | null>(() => initialDate(selectedDate) ?? parseDate(today));
  const latest = parseDate(today);
  return <Popover isOpen triggerRef={triggerRef} onOpenChange={open => { if (!open) onClose(); }} placement="bottom end" offset={8}
    className="z-[80] w-[324px] max-w-[calc(100vw-16px)] overflow-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
    <Dialog aria-label="Choose ranking date" className="outline-none">
      <form aria-label="View rankings by date" onSubmit={event => {
        event.preventDefault();
        if (value && value.compare(earliest) >= 0 && value.compare(latest) <= 0) {
          onView(value.toString() === today ? null : value.toString());
          onClose();
        }
      }}>
        <div className="mb-2 flex items-start gap-2 text-xs">
          <DateField name="date" value={value} onChange={setValue} isRequired minValue={earliest} maxValue={latest}
            placeholderValue={latest} validationBehavior="native" className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <Label className="shrink-0 whitespace-nowrap font-medium text-zinc-600">View date</Label>
            <DateInput className="flex h-11 min-w-0 items-center justify-center rounded-lg border border-zinc-200 bg-white px-2 tabular-nums text-zinc-900 focus-within:border-sky-500 [@media(pointer:coarse)]:text-base">
              {segment => <DateSegment segment={segment} className="rounded px-px outline-none data-[placeholder]:text-zinc-400 data-[focused]:bg-sky-100 data-[focused]:text-sky-900" />}
            </DateInput>
            <FieldError className="col-span-2 text-[11px] text-red-600" />
          </DateField>
          <button type="submit" className="h-11 shrink-0 rounded-lg bg-zinc-100 px-3 font-medium text-zinc-700 hover:bg-zinc-200">View</button>
        </div>
        <Calendar aria-label="Ranking date" value={value} onChange={setValue} minValue={earliest} maxValue={latest}>
          <CalendarHeading className="sr-only" />
          <header className="mb-1 flex items-center gap-1">
            <Button slot="previous" className={calendarButton}><ChevronLeft className="h-4 w-4" /></Button>
            <CalendarMonthPicker format="long">{props => <select aria-label="Month" value={props.value} onChange={event => props.onChange(Number(event.target.value))} className={`${calendarSelect} flex-1`}>
              {props.items.map(item => <option key={item.id} value={item.id}>{item.formatted}</option>)}
            </select>}</CalendarMonthPicker>
            <CalendarYearPicker visibleYears={latest.year - earliest.year + 1}>{props => <select aria-label="Year" value={props.value} onChange={event => props.onChange(Number(event.target.value))} className={`${calendarSelect} w-20`}>
              {props.items.map(item => <option key={item.id} value={item.id}>{item.formatted}</option>)}
            </select>}</CalendarYearPicker>
            <Button slot="next" className={calendarButton}><ChevronRight className="h-4 w-4" /></Button>
          </header>
          <CalendarGrid className="w-full table-fixed border-collapse" weekdayStyle="short">
            <CalendarGridHeader>{day => <CalendarHeaderCell className="h-8 text-[11px] font-medium text-zinc-500">{day}</CalendarHeaderCell>}</CalendarGridHeader>
            <CalendarGridBody>{date => <CalendarCell date={date} className="flex h-11 w-full cursor-pointer items-center justify-center rounded-lg text-sm text-zinc-900 outline-none hover:bg-zinc-100 data-[outside-month]:invisible data-[disabled]:cursor-default data-[disabled]:opacity-30 data-[selected]:bg-sky-600 data-[selected]:text-white data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-sky-500" />}</CalendarGridBody>
          </CalendarGrid>
        </Calendar>
      </form>
    </Dialog>
  </Popover>;
}
