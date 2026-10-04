import { useContext, useState } from "react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { DatePicker } from "react-aria-components/DatePicker";
import { DateInput, DateSegment } from "react-aria-components/DateField";
import { Button } from "react-aria-components/Button";
import { Group } from "react-aria-components/Group";
import { Label } from "react-aria-components/Label";
import { FieldError } from "react-aria-components/FieldError";
import { Popover } from "react-aria-components/Popover";
import { Dialog } from "react-aria-components/Dialog";
import { Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, CalendarHeading, CalendarMonthPicker, CalendarYearPicker } from "react-aria-components/Calendar";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { OptionsSheetOwner } from "./optionsSheetOwner";

const earliest = parseDate("2013-02-04");
const calendarButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100 disabled:opacity-30";
const calendarSelect = "h-11 min-w-0 rounded-lg border border-zinc-200 bg-white pl-2 pr-6 text-sm font-medium text-zinc-900";

function initialDate(date: string | null) {
  try { return date ? parseDate(date) : null; } catch { return null; }
}

/** Date drafts are applied only by View; Reset returns to today's rankings. */
export default function RankingsDatePicker({ selectedDate, today, onView }: {
  selectedDate: string | null; today: string; onView: (date: string | null) => void;
}) {
  const [value, setValue] = useState<CalendarDate | null>(() => initialDate(selectedDate));
  const owner = useContext(OptionsSheetOwner);
  const latest = parseDate(today);
  return <form aria-label="View rankings by date" onSubmit={event => {
    event.preventDefault();
    if (value && value.compare(earliest) >= 0 && value.compare(latest) <= 0) onView(value.toString());
  }} onReset={event => {
    event.preventDefault();
    setValue(null);
    onView(null);
  }}>
    <div className="flex items-start gap-1 text-[11px]">
      <DatePicker name="date" value={value} onChange={setValue} isRequired minValue={earliest} maxValue={latest}
        placeholderValue={latest} validationBehavior="native" className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-1">
        <Label className="shrink-0 whitespace-nowrap font-medium text-zinc-600">View date</Label>
        <Group className="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-zinc-200 bg-white text-zinc-900 focus-within:border-sky-500">
          <DateInput className="flex min-w-0 flex-1 items-center justify-center px-1 tabular-nums">
            {segment => <DateSegment segment={segment} className="rounded px-px outline-none data-[placeholder]:text-zinc-400 data-[focused]:bg-sky-100 data-[focused]:text-sky-900" />}
          </DateInput>
          <Button aria-label="Choose ranking date" className="flex h-full w-11 shrink-0 items-center justify-center rounded-r-lg text-zinc-500 hover:bg-zinc-100">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Group>
        <FieldError className="col-span-2 text-[11px] text-red-600" />
        <Popover data-options-sheet-owner={owner} placement="top end" offset={8}
          className="z-[80] w-[324px] max-w-[calc(100vw-16px)] overflow-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
          <Dialog aria-label="Choose ranking date" className="outline-none">
            <Calendar>
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
          </Dialog>
        </Popover>
      </DatePicker>
      <button type="submit" className="h-11 shrink-0 rounded-lg bg-zinc-100 px-2 font-medium text-zinc-700 hover:bg-zinc-200">View</button>
      <button type="reset" className="h-11 shrink-0 rounded-lg px-2 font-medium text-sky-600 hover:bg-zinc-100">Reset</button>
    </div>
  </form>;
}
