/**
 * The add/edit expense form is the web's store (../src/store/addStore.ts), shared as is: it is pure
 * zustand over ~/utils, and sharing it means both apps split, round, validate, invite and save
 * exactly the same way (its logic is tested in ../src/tests). Only screens live in mobile.
 */
export * from '~/store/addStore';
