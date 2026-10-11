'use client';

import { Step, Stepper as AstryxStepper } from '@astryxdesign/core/Stepper';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/utils';

export { StepTransition } from './motion';

export interface StepperStep {
  id: string;
  label: string;
}

/**
 * Wizard progress: numbered steps, done ones checked, the connector filling as you move on. On a phone it shows the
 * current step's name under the bar. Pass `onStepClick` to let people go back to a finished step. Pair it with
 * `StepTransition` for the step content.
 */
export function Stepper({
  steps,
  current,
  label,
  onStepClick,
  className,
}: {
  steps: readonly StepperStep[];
  /** Index of the current step (0-based). `steps.length` means everything is done. */
  current: number;
  /** Accessible name of the progress list (default "Progress"). */
  label?: string;
  onStepClick?: (index: number) => void;
  className?: string;
}) {
  const t = useTranslations('ui.stepper');
  return (
    <AstryxStepper
      activeStep={current}
      label={label ?? t('label')}
      // Only finished steps are a way back; the current and later ones are not.
      onStepClick={onStepClick ? (index) => index < current && onStepClick(index) : undefined}
      horizontalOptions={{ minimumStepWidth: 112, collapsedVariant: 'withLabel' }}
      className={cn(className)}
    >
      {steps.map((step, index) => (
        <Step key={step.id} step={index} label={step.label} />
      ))}
    </AstryxStepper>
  );
}
