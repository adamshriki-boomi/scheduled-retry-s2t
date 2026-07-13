import {
  Slider,
  SliderFilledTrack,
  SliderMark,
  SliderThumb,
  SliderTrack,
} from '@chakra-ui/react';
import * as React from 'react';

export interface LimitSliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  isDisabled?: boolean;
  ariaLabel?: string;
  /** Appended to the value and to the min/max end labels, e.g. "min" -> "5 min". */
  unitSuffix?: string;
  /** Track width; keeps the end labels from spreading too far apart. */
  width?: string;
}

/**
 * A Chakra v2 Slider that visibly shows its limits: the current value (with an
 * optional unit) floats above the thumb as a moving SliderMark, and the min/max
 * limits sit at the two ends of the track as static SliderMarks. Pure Chakra
 * Slider primitives — no Tooltip.
 */
export function LimitSlider({
  value,
  onChange,
  min,
  max,
  isDisabled = false,
  ariaLabel,
  unitSuffix,
  width = '320px',
}: LimitSliderProps) {
  // A slider must always have a numeric value; fall back to min when unset.
  const val = value ?? min;
  const fmt = (n: number) => (unitSuffix ? `${n} ${unitSuffix}` : String(n));

  return (
    <Slider
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={1}
      value={val}
      onChange={onChange}
      isDisabled={isDisabled}
      maxW={width}
      mt={7}
      mb={6}
      // Neutralize any ancestor `& input { width: ... }` rule (the account
      // settings form sets one) so the slider's visually-hidden input can't grow.
      sx={{ '& input': { width: '1px' } }}
    >
      {/* Current value, centered above the thumb */}
      <SliderMark
        value={val}
        textAlign="center"
        fontSize="xs"
        color="font"
        whiteSpace="nowrap"
        mt="-7"
        transform="translateX(-50%)"
      >
        {fmt(val)}
      </SliderMark>
      {/* Lower limit, left end */}
      <SliderMark value={min} mt="2" fontSize="xs" color="font-secondary">
        {fmt(min)}
      </SliderMark>
      {/* Upper limit, right end (pulled left so it isn't clipped past the track) */}
      <SliderMark
        value={max}
        mt="2"
        fontSize="xs"
        color="font-secondary"
        whiteSpace="nowrap"
        transform="translateX(-100%)"
      >
        {fmt(max)}
      </SliderMark>
      <SliderTrack>
        <SliderFilledTrack bg="primary" />
      </SliderTrack>
      <SliderThumb />
    </Slider>
  );
}
