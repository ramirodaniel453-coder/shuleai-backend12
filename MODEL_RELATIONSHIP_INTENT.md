# ShuleAI v2044 relationship intent

Versioned migrations and Sequelize declarations now enforce normal local entity references identified by the v2043 audit. Three identifier families intentionally remain non-FK because they are not single-table relations:

- `TeacherSubjectAssignment.schoolSubjectId` is an opaque curriculum/settings subject key. It is validated against the school's current subject configuration when assignments are created; it is not a row ID in a `SchoolSubjects` table.
- `ResourceViews.resourceId` is polymorphic and is interpreted together with `resourceType`. The service boundary must validate the target appropriate to that type; a single SQL foreign key would be incorrect.
- `AchievementEvent.sourceId` is polymorphic and is interpreted together with `sourceType` (`thread_reply`, `chat_message`, `manual`, etc.). Existence/authorization is enforced when the event is created.

These names are intentionally documented rather than being connected to a guessed table.
