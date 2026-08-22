export type OperatorFixture = {
  namespace: string;
  cleanupNamespace: string;
  companyId: string;
  admin: RoleAccount;
  employee: RoleAccount & { employeeId: string; crewId: string };
  customer: RoleAccount & { customerId: string; propertyId: string };
  routeDate: string;
  secondRouteDate: string;
  staleSundayDate: string;
  oldPublishedDate: string;
  hamiltonJobIds: string[];
  burlingtonJobIds: string[];
  jobIds: string[];
  created: {
    userIds: string[];
    profileIds: string[];
    customerIds: string[];
    propertyIds: string[];
    requestIds: string[];
    leadIds: string[];
    quoteIds: string[];
    jobIds: string[];
    routeIds: string[];
    visitIds: string[];
    storagePaths: string[];
  };
};

export type RoleAccount = {
  email: string;
  password: string;
  profileId: string;
};
