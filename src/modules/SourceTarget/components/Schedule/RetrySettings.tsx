import { TagLabel } from '@chakra-ui/react';
import {
  Flex,
  FormControl,
  FormErrorMessage,
  HStack,
  Icon,
  RetryUndoIcon,
  RiveryInfoTooltip,
  Tag,
  Text,
} from 'components';
import { RiverySwitch } from 'components/Form';
import { InputNumber } from 'components/Form/components/Input/InputNumber';
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
          Retry failed runs
        </Text>
        <Tag
          size="sm"
          variant="purple"
          borderRadius="999px"
          h="20px"
          flexShrink={0}
        >
          <TagLabel whiteSpace="nowrap">S2T only</TagLabel>
        </Tag>
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
            <Flex textStyle="R7" color="font" gap={2} alignItems="center">
              <Text>Max retries</Text>
              <InputNumber
                inputProps={{ min: 1, max: 12 }}
                fieldHeight="35px"
                w="60px"
                value={maxRetriesField.value}
                onChange={v => maxRetriesField.onChange(Number(v))}
                isDisabled={!enableEdit}
              />
              <Text color="font-secondary">(1–12)</Text>
            </Flex>
            <FormErrorMessage>
              {maxRetriesState.error?.message}
            </FormErrorMessage>
          </FormControl>
          <FormControl isInvalid={!!delayState.error}>
            <Flex textStyle="R7" color="font" gap={2} alignItems="center">
              <Text>Delay between retries</Text>
              <InputNumber
                inputProps={{ min: 1, max: 60 }}
                fieldHeight="35px"
                w="60px"
                value={delayField.value}
                onChange={v => delayField.onChange(Number(v))}
                isDisabled={!enableEdit}
              />
              <Text>minutes</Text>
              <Text color="font-secondary">(1–60)</Text>
            </Flex>
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
