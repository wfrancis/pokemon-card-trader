import { ReactNode } from 'react';
import { Tooltip } from '@mui/material';
import { GLOSSARY } from '../data/glossary';

interface GlossaryTooltipProps {
  term: string;
  children: ReactNode;
}

export default function GlossaryTooltip({ term, children }: GlossaryTooltipProps) {
  const definition = GLOSSARY[term];

  if (!definition) {
    return <>{children}</>;
  }

  return (
    <Tooltip
      title={definition}
      arrow
      enterDelay={200}
      leaveDelay={100}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: '#1a1a1a',
            color: '#ccc',
            border: '1px solid #333',
            fontSize: '0.7rem',
            maxWidth: 280,
            lineHeight: 1.4,
            p: 1,
          },
        },
        arrow: {
          sx: {
            color: '#1a1a1a',
          },
        },
      }}
    >
      <span style={{ borderBottom: '1px dotted #555', cursor: 'help' }}>
        {children}
      </span>
    </Tooltip>
  );
}
