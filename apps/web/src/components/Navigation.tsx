import { ChartNoAxesCombined, Clapperboard, History, Play, Terminal } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

const tabs = [
  { id: 'start', label: '启动', icon: Play },
  { id: 'stats', label: '统计', icon: ChartNoAxesCombined },
  { id: 'history', label: '对局记录', icon: History },
  { id: 'replay', label: '录像', icon: Clapperboard },
  { id: 'logs', label: '日志', icon: Terminal },
] as const;

export type TabId = (typeof tabs)[number]['id'];

type Props = { active: TabId; onChange: (tab: TabId) => void };

export function Navigation({ active, onChange }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index + tabs.length - 1) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(tabs[next]!.id);
    buttons.current[next]?.focus();
  }

  return (
    <nav
      className="flex gap-0.5 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:pb-0"
      role="tablist"
      aria-label="控制台页面"
    >
      {tabs.map(({ id, label, icon: Icon }, index) => {
        const selected = active === id;
        return (
          <button
            key={id}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            id={`tab-${id}`}
            className={`flex shrink-0 items-center gap-2 rounded-[3px] px-2.5 py-2 text-[13px] transition-colors lg:w-full ${
              selected
                ? 'bg-teal-soft font-medium text-teal-dark'
                : 'text-muted hover:bg-canvas hover:text-ink'
            }`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon size={15} strokeWidth={2} aria-hidden="true" />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
