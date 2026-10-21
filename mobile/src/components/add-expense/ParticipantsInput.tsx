import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { z } from 'zod';

import { Avatar, Icon, Section, Text, icons } from '@/components/ui';
import { isPendingInvite, useAddExpenseStore } from '@/store/addExpenseStore';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

import { useInviteFriend } from './useInviteFriend';

/** A selected person or group, like a recipient token in Mail's "To:" field. */
const Token: React.FC<{
  name: string;
  email?: string | null;
  image?: string | null;
  pending?: boolean;
  onRemove?: () => void;
  removeLabel: string;
}> = ({ name, email, image, pending, onRemove, removeLabel }) => (
  <View style={[styles.token, pending ? styles.pending : null]}>
    <Avatar name={name} email={email} image={image} size={24} />
    <Text variant="subheadline" numberOfLines={1} style={styles.tokenLabel}>
      {name}
    </Text>
    {onRemove ? (
      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
      >
        <Icon name={icons.removeCircle} size={16} color={colors.tertiaryLabel} />
      </Pressable>
    ) : null}
  </View>
);

/**
 * Who the expense is with: the group or friends as tokens, and a field to search or add an email.
 * Like the web's UserInput, backspace in the empty field removes the group or the last friend.
 */
export const ParticipantsInput: React.FC<{ isEditing: boolean }> = ({ isEditing }) => {
  const { t } = useTranslation();
  const nameOrEmail = useAddExpenseStore((s) => s.nameOrEmail);
  const participants = useAddExpenseStore((s) => s.participants);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const group = useAddExpenseStore((s) => s.group);
  const { setNameOrEmail, removeLastParticipant, removeParticipant, setParticipants, setGroup } =
    useAddExpenseStore((s) => s.actions);
  const invite = useInviteFriend();

  const isGroupLocked = isEditing && !!group;

  const removeGroup = () => {
    setGroup(undefined);
    if (currentUser) {
      setParticipants([currentUser]);
    }
  };

  const onBackspace = () => {
    if ('' !== nameOrEmail || isGroupLocked) {
      return;
    }

    if (group) {
      removeGroup();
      return;
    }

    removeLastParticipant();
  };

  const onSubmit = () => {
    const email = nameOrEmail.trim().toLowerCase();
    if (group || !z.string().email().safeParse(email).success) {
      return;
    }

    setNameOrEmail(email);
    invite(email);
  };

  const placeholder = group
    ? t('expense.remove_group_hint')
    : 1 < participants.length
      ? t('expense.add_more_friends')
      : t('expense.search_placeholder');

  return (
    <Section footer={isGroupLocked ? t('expense.cannot_change_group') : undefined}>
      <View style={styles.field}>
        <Text color="secondaryLabel" style={styles.label}>
          {t('expense.with_you_and')}
        </Text>
        {group ? (
          <Token
            name={group.name}
            onRemove={isGroupLocked ? undefined : removeGroup}
            removeLabel={t('expense.remove_named', { name: group.name })}
          />
        ) : (
          participants
            .filter((participant) => participant.id !== currentUser?.id)
            .map((participant) => {
              const name = participant.name ?? participant.email ?? '';
              return (
                <Token
                  key={participant.id}
                  name={name}
                  email={participant.email}
                  image={participant.image}
                  pending={isPendingInvite(participant)}
                  onRemove={() => removeParticipant(participant.id)}
                  removeLabel={t('expense.remove_named', { name })}
                />
              );
            })
        )}
        {isGroupLocked ? null : (
          <TextInput
            value={nameOrEmail}
            onChangeText={setNameOrEmail}
            onKeyPress={({ nativeEvent }) => {
              if ('Backspace' === nativeEvent.key) {
                onBackspace();
              }
            }}
            onSubmitEditing={onSubmit}
            submitBehavior="submit"
            placeholder={placeholder}
            placeholderTextColor={colors.placeholder}
            selectionColor={colors.tint}
            cursorColor={colors.tint}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="done"
            autoFocus={!isEditing && !group && 1 === participants.length}
            accessibilityLabel={t('expense.search_placeholder')}
            style={styles.input}
          />
        )}
      </View>
    </Section>
  );
};

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: layout.rowMinHeight,
    paddingVertical: spacing[2],
    paddingHorizontal: layout.rowPadding,
  },
  label: {
    marginRight: spacing[1],
  },
  token: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    maxWidth: '100%',
    paddingVertical: 3,
    paddingLeft: 3,
    paddingRight: spacing[2],
    borderRadius: radii.full,
    backgroundColor: colors.tertiaryFill,
  },
  pending: {
    opacity: 0.6,
  },
  tokenLabel: {
    flexShrink: 1,
  },
  input: {
    ...typography.body,
    lineHeight: undefined,
    flexGrow: 1,
    minWidth: 140,
    minHeight: 30,
    paddingVertical: 0,
    color: colors.label,
  },
});
