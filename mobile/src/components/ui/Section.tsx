import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, layout, radii, spacing } from '@/theme/tokens';

import { Separator } from './ListRow';
import { Text } from './Text';

export interface SectionProps {
  /** Short heading above the section, e.g. "Balance by group". */
  header?: string;
  /** Explanation below the section. */
  footer?: string;
  /** Left inset of the separators between children; see `rowInset`. */
  separatorInset?: number;
  children: React.ReactNode;
  style?: ViewStyle;
}

/** The heading above an inset-grouped section. Also use it in a SectionList's `renderSectionHeader`. */
export const SectionHeader: React.FC<{ title: string; large?: boolean }> = ({ title, large }) => (
  <Text
    variant={large ? 'title3' : 'footnote'}
    color={large ? 'label' : 'secondaryLabel'}
    accessibilityRole="header"
    style={[styles.header, large ? styles.largeHeader : null]}
  >
    {title}
  </Text>
);

/**
 * An inset-grouped section (Settings, a Contacts card, a Form): rows on a rounded background with
 * separators between them. Put it on a `groupedBackground` screen. Children are usually
 * `ListRow`s; any view works. For long lists use a SectionList with `SectionCell` instead.
 */
export const Section: React.FC<SectionProps> = ({
  header,
  footer,
  separatorInset,
  children,
  style,
}) => {
  const rows = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.container, style]}>
      {header ? <SectionHeader title={header} /> : null}
      <View style={styles.card}>
        {rows.map((row, index) => (
          <React.Fragment key={index}>
            {0 < index ? <Separator inset={separatorInset} /> : null}
            {row}
          </React.Fragment>
        ))}
      </View>
      {footer ? (
        <Text variant="footnote" color="secondaryLabel" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
};

export interface SectionCellProps {
  /** First row of its section: rounds the top corners. */
  first?: boolean;
  /** Last row of its section: rounds the bottom corners, no separator. */
  last?: boolean;
  separatorInset?: number;
  children: React.ReactNode;
}

/**
 * One row of an inset-grouped section in a virtualized SectionList, where a `Section` can't wrap
 * the rows (e.g. expenses grouped by month).
 *
 * @example
 * renderItem={({ item, index, section }) => (
 *   <SectionCell first={0 === index} last={index === section.data.length - 1}>
 *     <ExpenseListItem … />
 *   </SectionCell>
 * )}
 */
export const SectionCell: React.FC<SectionCellProps> = ({
  first,
  last,
  separatorInset,
  children,
}) => (
  <View style={[styles.cell, first ? styles.first : null, last ? styles.last : null]}>
    {children}
    {last ? null : <Separator inset={separatorInset} />}
  </View>
);

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[6],
  },
  header: {
    paddingHorizontal: layout.sectionMargin + layout.rowPadding,
    paddingBottom: spacing[2],
  },
  largeHeader: {
    paddingHorizontal: layout.sectionMargin + spacing[1],
    paddingTop: spacing[2],
  },
  card: {
    marginHorizontal: layout.sectionMargin,
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radii.section,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  footer: {
    paddingHorizontal: layout.sectionMargin + layout.rowPadding,
    paddingTop: spacing[2],
  },
  cell: {
    marginHorizontal: layout.sectionMargin,
    backgroundColor: colors.secondaryGroupedBackground,
    overflow: 'hidden',
  },
  first: {
    borderTopLeftRadius: radii.section,
    borderTopRightRadius: radii.section,
    borderCurve: 'continuous',
  },
  last: {
    borderBottomLeftRadius: radii.section,
    borderBottomRightRadius: radii.section,
    borderCurve: 'continuous',
    marginBottom: spacing[6],
  },
});
