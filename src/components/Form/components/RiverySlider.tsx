import { FormControl } from '@chakra-ui/react';
import { Controller } from 'react-hook-form';
import { InputLabel } from '.';
import { LimitSlider } from './LimitSlider';

interface RiverySliderProps {
  api?: any;
  name?: string;
  /** ControlResolver maps the control's `display_name` onto `label`. */
  label?: string;
  display_name?: string;
  min?: number;
  max?: number;
  unitSuffix?: string;
  isDisabled?: boolean;
  formControlStyle?: any;
  [key: string]: any;
}

/**
 * React-Hook-Form wrapper that adapts <LimitSlider /> into the declarative form
 * control system (ControlList.SLIDER). Follows the RiverySwitch Controller
 * pattern: renders the field label, then binds the slider value via <Controller>.
 */
export function RiverySlider({
  api,
  name,
  label,
  display_name,
  min = 1,
  max = 100,
  unitSuffix,
  isDisabled = false,
  formControlStyle = null,
}: RiverySliderProps) {
  const control = api?.control;
  const fieldLabel = label ?? display_name;

  return (
    <FormControl {...formControlStyle}>
      {fieldLabel ? (
        <InputLabel htmlFor={name} label={fieldLabel} mb={0} />
      ) : null}
      {control ? (
        <Controller
          control={control}
          name={name}
          render={({ field: { value, onChange } }) => (
            <LimitSlider
              value={value ?? min}
              onChange={onChange}
              min={min}
              max={max}
              unitSuffix={unitSuffix}
              isDisabled={isDisabled}
              ariaLabel={fieldLabel}
            />
          )}
        />
      ) : null}
    </FormControl>
  );
}
