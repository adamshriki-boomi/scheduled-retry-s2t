import {
  Flex,
  FormControl,
  FormErrorMessage,
  HStack,
  Icon,
  RetryUndoIcon,
  RiveryInfoTooltip,
  Text,
} from 'components';
import { RiverySwitch } from 'components/Form';
import { LimitSlider } from 'components/Form/components/LimitSlider';
import { useEnableEdit } from 'hooks/useEnableEdit';
import { useController } from 'react-hook-form';
import { useAccount } from 'store/core';
import { useSttFormContext } from '../form';

export function RetrySettings() {
  const formApi = useSttFormContext();
  const { accountSettings } = useAccount();
  const { enableEdit } = useEnableEdit();

  const { field: isEnabledField } = useController({
    name: 'river.settings.scheduled_retry.is_enabled',
    control: formApi?.control,
  });

  const { field: maxRetriesField, fieldState: maxRetriesState } = useController(
    {
      name: 'river.settings.scheduled_retry.max_retries',
      control: formApi?.control,
      rules: isEnabledField.value
        ? {
            required: 'Max retries is required',
            min: {
              value: 1,
              message: 'Max retries must be between 1 and 12',
            },
            max: {
              value: 12,
              message: 'Max retries must be between 1 and 12',
            },
          }
        : {},
    },
  );

  const { field: delayField, fieldState: delayState } = useController({
    name: 'river.settings.scheduled_retry.delay_minutes',
    control: formApi?.control,
    rules: isEnabledField.value
      ? {
          required: 'Delay is required',
          min: {
            value: 1,
            message: 'Delay must be between 1 and 60 minutes',
          },
          max: {
            value: 60,
            message: 'Delay must be between 1 and 60 minutes',
          },
        }
      : {},
  });

  const isToggleOn = Boolean(isEnabledField.value);

  const handleToggleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    isEnabledField.onChange(checked);
    if (checked) {
      if (maxRetriesField.value == null) {
        maxRetriesField.onChange(
          accountSettings?.scheduled_retry_max_retries ?? 3,
        );
      }
      if (delayField.value == null) {
        delayField.onChange(
          accountSettings?.scheduled_retry_delay_minutes ?? 5,
        );
      }
    } else {
      // Clear stale validation errors when toggle is switched OFF
      formApi?.clearErrors([
        'river.settings.scheduled_retry.max_retries',
        'river.settings.scheduled_retry.delay_minutes',
      ]);
    }
  };

  return (
    <Flex flexDir="column" gap={2} w="full">
      <HStack w="full">
        <Icon as={RetryUndoIcon} color="primary" boxSize={4} flexShrink={0} />
        <Text textStyle="M6" color="primary" flexShrink={0}>
          Scheduled Retry
        </Text>
        <RiveryInfoTooltip description="Manual runs and schedules more frequent than every 2 hours are not retried." />
        <RiverySwitch
          label=""
          ml="auto"
          isChecked={isToggleOn}
          onChange={handleToggleChange}
          isDisabled={!enableEdit}
        />
      </HStack>
      <Text textStyle="R7" color="font-secondary">
        Applies to failed runs triggered by Schedule, API, or Logic.
      </Text>
      {isToggleOn ? (
        <Flex flexDir="column" gap={2}>
          <FormControl isInvalid={!!maxRetriesState.error}>
            <Text textStyle="R7" color="font">
              Max retries
            </Text>
            <LimitSlider
              value={maxRetriesField.value}
              onChange={maxRetriesField.onChange}
              min={1}
              max={12}
              isDisabled={!enableEdit}
              ariaLabel="Max retries"
              width="240px"
            />
            <FormErrorMessage>
              {maxRetriesState.error?.message}
            </FormErrorMessage>
          </FormControl>
          <FormControl isInvalid={!!delayState.error}>
            <Text textStyle="R7" color="font">
              Delay between retries
            </Text>
            <LimitSlider
              value={delayField.value}
              onChange={delayField.onChange}
              min={1}
              max={60}
              unitSuffix="min"
              isDisabled={!enableEdit}
              ariaLabel="Delay between retries"
              width="240px"
            />
            <FormErrorMessage>{delayState.error?.message}</FormErrorMessage>
          </FormControl>
        </Flex>
      ) : (
        <Text textStyle="R7" color="font-secondary">
          Failed runs will not be retried automatically.
        </Text>
      )}
    </Flex>
  );
}
