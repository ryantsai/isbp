/**
 * COMPILED RECIPES — the canonical way to write each UI pattern with Astryx in this codebase.
 *
 * `docs/ai/ui-components.md` quotes these. The file is type-checked with `pnpm typecheck`, so a pattern that stops
 * compiling after an Astryx upgrade fails CI instead of silently rotting in the docs. Nothing here is rendered or
 * exported to the app: copy a recipe, then replace the placeholder strings with `t('…')` catalog keys (never English
 * literals in product code).
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { DateInput } from '@astryxdesign/core/DateInput';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Divider } from '@astryxdesign/core/Divider';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Field } from '@astryxdesign/core/Field';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Popover } from '@astryxdesign/core/Popover';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '../src/components/form-dialog';
import { Controller, type ControllerFieldState, useForm } from 'react-hook-form';

/* ───────────────────────────── Buttons ───────────────────────────── */

/**
 * `label` is the visible text AND the accessible name (never put text in `children`). Variants: `primary` (the one next
 * step), `secondary` (default: everything else), `ghost` (toolbars, tertiary), `destructive` (only inside a confirm).
 * `isLoading` shows a spinner and blocks clicks; `isDisabled` with `tooltip`/`disabledMessage` explains why.
 */
export function ButtonRecipes({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <HStack gap={2} wrap="wrap">
      <Button label="Save" variant="primary" isLoading={saving} onClick={onSave} />
      <Button label="New asset" variant="secondary" icon={<Icon icon={PlusIcon} />} />
      <Button label="Cancel" variant="ghost" />
      {/* A link that looks like a button: `href` renders an <a> through the app's LinkProvider (Next.js Link). */}
      <Button label="Open ticket" href="/itsm/tickets/INC-00101" variant="secondary" />
      {/* Icon-only: IconButton, with a label for screen readers (also its tooltip). */}
      <IconButton label="Edit" variant="ghost" icon={<Icon icon={PencilIcon} />} onClick={onSave} />
      <Button label="Submit" type="submit" form="my-form" variant="primary" isDisabled />
    </HStack>
  );
}

/* ───────────────────────────── Form fields ───────────────────────────── */

/**
 * Every Astryx input renders its own label, hint (`description`), required/optional marker and error (`status`):
 * there is no separate Label/FormItem/FormMessage. `onChange` receives the VALUE, not an event.
 */
export function FieldRecipes() {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<number | null>(1);
  const [kind, setKind] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [agree, setAgree] = useState(false);
  const [mode, setMode] = useState('a');
  const [due, setDue] = useState<ISODateString | undefined>();
  return (
    <VStack gap={4}>
      <TextInput
        label="Name"
        isRequired
        description="Shown in lists."
        value={name}
        onChange={setName}
        status={name.length > 40 ? { type: 'error', message: 'Too long' } : undefined}
      />
      <TextArea label="Notes" isOptional rows={3} value={notes} onChange={setNotes} />
      <NumberInput label="Quantity" value={qty} onChange={setQty} />
      {/* Selector: bounded options. `hasSearch` for long lists, `hasClear` when "none" is valid (value null). */}
      <Selector
        label="Kind"
        value={kind}
        onChange={setKind}
        hasClear
        placeholder="Choose…"
        options={[
          { value: 'laptop', label: 'Laptop', description: 'Portable' },
          { value: 'phone', label: 'Phone' },
        ]}
      />
      {/* Boolean that takes effect at once → Switch; a boolean in a form to submit → CheckboxInput. */}
      <Switch label="Active" description="Inactive items are hidden." value={active} onChange={setActive} />
      <CheckboxInput label="I agree" value={agree} onChange={setAgree} />
      <RadioList label="Mode" value={mode} onChange={setMode}>
        <RadioListItem value="a" label="Automatic" />
        <RadioListItem value="b" label="Manual" />
      </RadioList>
      <DateInput label="Due" value={due} onChange={setDue} />
      {/* A custom control (our pickers, a code editor) gets the same label/hint/error frame from <Field>. */}
      <Field label="Approvers" inputID="approvers" description="Anyone in these groups decides.">
        <div id="approvers">…your control…</div>
      </Field>
    </VStack>
  );
}

/** react-hook-form: `Controller` (our `FormField`) + the Astryx input; the error comes from `fieldState`. */
export function fieldStatus(state: ControllerFieldState): { type: 'error'; message: string } | undefined {
  return state.error ? { type: 'error', message: String(state.error.message ?? '') } : undefined;
}
export function HookFormRecipe({ onSubmit }: { onSubmit: (v: { email: string }) => void }) {
  const form = useForm<{ email: string }>({ defaultValues: { email: '' } });
  return (
    <form id="my-form" onSubmit={form.handleSubmit(onSubmit)}>
      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <TextInput
            label="Email"
            isRequired
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            status={fieldStatus(fieldState)}
          />
        )}
      />
    </form>
  );
}

/* ───────────────────────────── Dialogs ───────────────────────────── */

/**
 * A modal for a few fields or one small task (≤ 4 fields; more is a `Sheet`): `FormDialog` from `@isbp/ui`. It owns the
 * header, the scrolling body and the Cancel + primary footer, and `purpose="form"` so a stray click outside can't discard
 * input. Open state is yours (there is no trigger part). Never assemble `Dialog` + `Layout` by hand.
 */
export function DialogRecipe({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  return (
    <FormDialog
      isOpen={open}
      onOpenChange={setOpen}
      title="Assign asset"
      subtitle="Choose who gets it."
      size="sm"
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      submitLabel="Assign"
      cancelLabel="Cancel"
      defaultOptionality="required"
    >
      <TextInput label="Person" value="" onChange={() => {}} />
    </FormDialog>
  );
}

/**
 * Destructive or irreversible: AlertDialog. It names the object and the consequence; `onAction` does NOT close it
 * (close it yourself once the call succeeds, so a failure keeps the dialog open).
 */
export function ConfirmRecipe({
  open,
  setOpen,
  busy,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  busy: boolean;
}) {
  return (
    <AlertDialog
      isOpen={open}
      onOpenChange={setOpen}
      title="Delete “Server room”?"
      description="Its 14 assets lose their location. This can't be undone."
      actionLabel="Delete"
      cancelLabel="Cancel"
      isActionLoading={busy}
      onAction={() => setOpen(false)}
    />
  );
}

/* ───────────────────────────── Tabs, menus, hints ───────────────────────────── */

/** Tabs: `TabList` + `Tab`s hold the selection; YOU render the panel for the selected value. */
export function TabsRecipe() {
  const [tab, setTab] = useState('overview');
  return (
    <VStack gap={3}>
      <TabList value={tab} onChange={setTab} hasDivider>
        <Tab value="overview" label="Overview" />
        <Tab value="history" label="History" endContent={<Badge label="3" />} />
      </TabList>
      {tab === 'overview' ? <Text>Overview…</Text> : <Text>History…</Text>}
    </VStack>
  );
}

/** Row actions: `MoreMenu` (⋯). Destructive items go last, after a divider, and confirm. */
export function MenuRecipes({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <HStack gap={2}>
      <MoreMenu
        label="More actions"
        items={[
          { label: 'Edit', icon: PencilIcon, onClick: onEdit },
          { type: 'divider' },
          { label: 'Delete', icon: Trash2Icon, variant: 'destructive', onClick: onDelete },
        ]}
      />
      <DropdownMenu
        button={{ label: 'Other status', variant: 'secondary' }}
        items={[{ label: 'On hold', onClick: onEdit }]}
      />
    </HStack>
  );
}

/** Tooltip = a short hint on hover/focus (never essential info, never interactive content). Popover = click-opened. */
export function HintRecipes() {
  return (
    <HStack gap={3}>
      <Tooltip content="Search everything">
        <IconButton label="Search" variant="ghost" icon={<Icon icon={SearchIcon} />} />
      </Tooltip>
      <Popover content={<Text>Anything interactive goes here.</Text>} label="Details" placement="below">
        <Button label="Details" variant="ghost" />
      </Popover>
    </HStack>
  );
}

/* ───────────────────────────── Feedback and display ───────────────────────────── */

/** Status = icon + text (never colour alone). Badge variants: neutral, info, success, warning, error. */
export function DisplayRecipes({ loading }: { loading: boolean }) {
  if (loading) {
    // A skeleton shaped like the result.
    return (
      <VStack gap={2}>
        <Skeleton width="60%" height={20} />
        <Skeleton width="100%" height={14} />
      </VStack>
    );
  }
  return (
    <VStack gap={3}>
      <Badge variant="success" label="Active" />
      <Banner
        status="warning"
        title="Backup is overdue"
        description="Last run 3 days ago."
        collapsible={false}
      />
      <HStack gap={2} vAlign="center">
        <Avatar name="Platform Admin" size="sm" />
        <Link href="/admin/users">Platform Admin</Link>
        <Spinner size="sm" />
      </HStack>
      <ProgressBar label="Stocktake" value={44} hasValueLabel />
      <Collapsible trigger={<Text weight="medium">Technical details</Text>} defaultIsOpen={false}>
        <Text type="code">stack trace…</Text>
      </Collapsible>
      <Divider />
    </VStack>
  );
}

/** Layout primitives replace `flex`/`grid` utility soup: `VStack`/`HStack` (gap on the 0–10 spacing scale), `Grid`. */
export function LayoutRecipe() {
  return (
    <VStack gap={4}>
      <Heading level={2}>Section</Heading>
      <Grid columns={{ minWidth: 240 }} gap={4}>
        <Text>One</Text>
        <Text>Two</Text>
      </Grid>
      <HStack gap={2} hAlign="between" vAlign="center">
        <StackItem size="fill">
          <Text color="secondary">Left grows</Text>
        </StackItem>
        <Button label="Right" />
      </HStack>
    </VStack>
  );
}
