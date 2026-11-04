import { Redirect } from 'expo-router';
import React from 'react';

/** Backs the Add tab button, which opens /add. Only reachable through a deep link to /new. */
const NewExpense = () => <Redirect href="/add" />;

export default NewExpense;
