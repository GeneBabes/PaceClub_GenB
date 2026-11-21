import { useRef, useState } from "react";
import { View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useAccountData } from "./Context";
import { checked, db, date, km, rpc, useAction, useData } from "./data";
import {
  Button,
  Card,
  Choices,
  Confirm,
  Feedback,
  Field,
  Frame,
  H,
  P,
  Photo,
  styles,
  ui,
} from "./ui";
import { pickPhoto, uploadPhoto, type PickedPhoto } from "./photos";
import type {
  Club,
  Conversation,
  Message,
  Post,
  Profile,
  RemoteActivity,
} from "./types";
export function Community() {
  const id = useAccountData().data!.profile.id,
    [page, setPage] = useState(0),
    [publish, setPublish] = useState(false);
  const q = useData(
    "feed-" + page,
    () => rpc<Post[]>("pc_feed", { p_offset: page * 20 }),
    ["activity_posts", "post_kudos", "post_comments"],
  );
  return (
    <Frame
      title="Good company. Good miles."
      subtitle="Photos and activity summaries, with private GPS routes kept private."
    >
      <Button onPress={() => setPublish(!publish)}>
        Share a verified activity
      </Button>
      {publish && <Publish userId={id} reload={q.reload} />}
      <Feedback state={q} />
      {q.data?.map((p) => (
        <PostCard key={p.id} post={p} userId={id} reload={q.reload} />
      ))}
      {q.data?.length === 0 && (
        <P>Your community’s shared activities will appear here.</P>
      )}
      <View style={ui.row}>
        <Button
          secondary
          disabled={!page}
          onPress={() => setPage((p) => p - 1)}
        >
          Newer
        </Button>
        <Button
          secondary
          disabled={!q.data || q.data.length < 20}
          onPress={() => setPage((p) => p + 1)}
        >
          Older
        </Button>
      </View>
    </Frame>
  );
}
function Publish({ userId, reload }: { userId: string; reload: () => void }) {
  const [selected, setSelected] = useState(""),
    [caption, setCaption] = useState(""),
    [visibility, setVisibility] = useState("private"),
    [club, setClub] = useState(""),
    [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const uploaded = useRef<{
      uri: string;
      activity: string;
      path: string;
    } | null>(null),
    a = useAction(),
    q = useData("publish", async () => ({
      activities: checked(
        await db
          .from("activities")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "verified")
          .neq("source", "simulation")
          .order("started_at", { ascending: false })
          .limit(100),
      ) as RemoteActivity[],
      clubs: (await rpc<Club[]>("pc_club_directory")).filter((c) => c.my_role),
    }));
  return (
    <Card>
      <H>Share your moment</H>
      <Feedback state={q} />
      <Choices
        label="Activity"
        value={selected}
        onChange={setSelected}
        options={(q.data?.activities || []).map((x) => ({
          id: x.id,
          label: x.activity_type + " · " + date(x.started_at),
        }))}
      />
      <Field label="Caption" value={caption} onChange={setCaption} multiline />
      <View style={ui.row}>
        <Button
          secondary
          disabled={a.busy}
          onPress={() =>
            void a.run(
              async () => setPhoto(await pickPhoto(true)),
              "Photo selected.",
            )
          }
        >
          Take photo
        </Button>
        <Button
          secondary
          disabled={a.busy}
          onPress={() =>
            void a.run(
              async () => setPhoto(await pickPhoto()),
              "Photo selected.",
            )
          }
        >
          Choose photo
        </Button>
      </View>
      {photo && (
        <>
          <P>Photo attached.</P>
          <Button secondary onPress={() => setPhoto(null)}>
            Remove photo
          </Button>
        </>
      )}
      <Choices
        label="Visibility"
        value={visibility}
        onChange={setVisibility}
        options={[
          { id: "private", label: "Only me" },
          { id: "members", label: "Members" },
          { id: "club", label: "Club" },
        ]}
      />
      {visibility === "club" && (
        <Choices
          label="Club"
          value={club}
          onChange={setClub}
          options={(q.data?.clubs || []).map((c) => ({
            id: c.id,
            label: c.name,
          }))}
        />
      )}
      <Button
        disabled={a.busy || !selected}
        onPress={() =>
          void a.run(async () => {
            let path: string | null = null;
            if (photo) {
              if (
                uploaded.current?.uri !== photo.uri ||
                uploaded.current.activity !== selected
              )
                uploaded.current = {
                  uri: photo.uri,
                  activity: selected,
                  path: await uploadPhoto(photo, userId + "/" + selected),
                };
              path = uploaded.current.path;
            }
            await rpc("pc_publish_activity", {
              p_id: selected,
              p_caption: caption,
              p_visibility: visibility,
              p_club: visibility === "club" ? club : null,
              p_photo: path,
            });
            reload();
          }, "Activity shared. Your route remains private.")
        }
      >
        Publish
      </Button>
      <Feedback state={a} />
    </Card>
  );
}
function PostCard({
  post: p,
  userId,
  reload,
}: {
  post: Post;
  userId: string;
  reload: () => void;
}) {
  const [comments, setComments] = useState(false),
    [edit, setEdit] = useState(false),
    [caption, setCaption] = useState(p.caption),
    a = useAction();
  return (
    <Card>
      <Photo path={p.avatar_path} bucket="avatars" avatar />
      <H>{p.display_name}</H>
      <P>
        {date(p.created_at)} · {p.visibility} · {p.source}
      </P>
      <Photo path={p.photo_path} />
      <P>{p.caption}</P>
      <H>
        {p.activity_type.toUpperCase()} · {km(p.distance_m)}
      </H>
      <View style={ui.row}>
        <Button
          secondary
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              checked(
                p.liked
                  ? await db
                      .from("post_kudos")
                      .delete()
                      .eq("post_id", p.id)
                      .eq("user_id", userId)
                  : await db
                      .from("post_kudos")
                      .insert({ post_id: p.id, user_id: userId }),
              );
              reload();
            }, "Kudos updated.")
          }
        >
          {p.liked ? "♥" : "♡"} {p.kudos} kudos
        </Button>
        <Button secondary onPress={() => setComments(!comments)}>
          {p.comments} comments
        </Button>
      </View>
      {p.author_id === userId ? (
        <>
          <Button secondary onPress={() => setEdit(!edit)}>
            Edit caption & privacy
          </Button>
          {edit && (
            <>
              <Field
                label="Caption"
                value={caption}
                onChange={setCaption}
                multiline
              />
              {["private", "members", ...(p.club_id ? ["club"] : [])].map(
                (vis) => (
                  <Button
                    key={vis}
                    secondary
                    disabled={a.busy}
                    onPress={() =>
                      void a.run(async () => {
                        checked(
                          await db
                            .from("activity_posts")
                            .update({
                              caption,
                              visibility: vis,
                              club_id: vis === "club" ? p.club_id : null,
                            })
                            .eq("id", p.id)
                            .select("id")
                            .single(),
                        );
                        reload();
                      })
                    }
                  >
                    Save · {vis === "private" ? "Only me" : vis}
                  </Button>
                ),
              )}
            </>
          )}
        </>
      ) : (
        <Report id={p.id} kind="post" />
      )}
      <Feedback state={a} />
      {comments && <Comments postId={p.id} userId={userId} />}
    </Card>
  );
}
export function Report({
  id,
  kind,
}: {
  id: string;
  kind: "post" | "comment" | "message";
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    a = useAction();
  return (
    <View style={{ gap: 8 }}>
      <Button secondary onPress={() => setOpen(!open)}>
        Report {kind}
      </Button>
      {open && (
        <>
          <Field
            label="Reason for report"
            value={reason}
            onChange={setReason}
            maxLength={1000}
          />
          <Button
            disabled={a.busy || reason.trim().length < 3}
            onPress={() =>
              void a.run(
                () =>
                  rpc(
                    kind === "message"
                      ? "pc_report_message"
                      : "pc_report_content",
                    kind === "message"
                      ? { p_message_id: id, p_reason: reason }
                      : {
                          p_id: id,
                          p_comment: kind === "comment",
                          p_reason: reason,
                        },
                  ),
                "Report sent to moderators.",
              )
            }
          >
            Send report
          </Button>
          <Feedback state={a} />
        </>
      )}
    </View>
  );
}
function Comments({ postId, userId }: { postId: string; userId: string }) {
  const [body, setBody] = useState(""),
    [page, setPage] = useState(0),
    a = useAction();
  const q = useData(
    "comments-" + postId + "-" + page,
    async () => {
      const rows = checked(
        await db
          .from("post_comments")
          .select("*")
          .eq("post_id", postId)
          .order("created_at")
          .order("id")
          .range(page * 20, page * 20 + 19),
      ) as {
        id: string;
        user_id: string;
        body: string;
        removed_at: string | null;
      }[];
      const people = rows.length
        ? (checked(
            await db
              .from("profiles")
              .select("id,display_name")
              .in(
                "id",
                rows.map((r) => r.user_id),
              ),
          ) as Profile[])
        : [];
      return rows.map((r) => ({
        ...r,
        name: people.find((p) => p.id === r.user_id)?.display_name || "Athlete",
      }));
    },
    ["post_comments"],
  );
  return (
    <>
      <Feedback state={q} />
      {q.data?.map((c) => (
        <View key={c.id} style={styles.divider}>
          <H>{c.name}</H>
          <P>{c.body}</P>
          {c.user_id === userId ? (
            <Button
              secondary
              disabled={a.busy}
              onPress={() =>
                Confirm(
                  "Delete comment?",
                  "Your comment will be removed.",
                  () =>
                    void a.run(async () => {
                      checked(
                        await db.from("post_comments").delete().eq("id", c.id),
                      );
                      q.reload();
                    }),
                )
              }
            >
              Delete
            </Button>
          ) : (
            !c.removed_at && <Report id={c.id} kind="comment" />
          )}
        </View>
      ))}
      <View style={ui.row}>
        <Button
          secondary
          disabled={!page}
          onPress={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <Button
          secondary
          disabled={!q.data || q.data.length < 20}
          onPress={() => setPage((p) => p + 1)}
        >
          More
        </Button>
      </View>
      <Field
        label="Add a comment"
        value={body}
        onChange={setBody}
        multiline
        maxLength={1000}
      />
      <Button
        disabled={a.busy || !body.trim()}
        onPress={() =>
          void a.run(async () => {
            checked(
              await db
                .from("post_comments")
                .insert({ post_id: postId, user_id: userId, body }),
            );
            setBody("");
            q.reload();
          })
        }
      >
        Add comment
      </Button>
      <Feedback state={a} />
    </>
  );
}
export function Chat() {
  const userId = useAccountData().data!.profile.id,
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [person, setPerson] = useState(""),
    a = useAction();
  const q = useData(
    "chat",
    async () => ({
      conversations: checked(
        await db.from("conversations").select("*").order("created_at"),
      ) as Conversation[],
      profiles: checked(
        await db.from("profiles").select("id,display_name").limit(1000),
      ) as Profile[],
      clubs: await rpc<Club[]>("pc_club_directory"),
      blocks: checked(await db.from("user_blocks").select("blocked_id")) as {
        blocked_id: string;
      }[],
    }),
    ["conversations", "conversation_members", "user_blocks"],
  );
  const active = q.data?.conversations.find((c) => c.id === selected),
    other = (c: Conversation) =>
      c.direct_user_a === userId ? c.direct_user_b : c.direct_user_a;
  const name = (id: string | null) =>
    q.data?.profiles.find((p) => p.id === id)?.display_name || "Member";
  const label = (c: Conversation) =>
    c.type === "global"
      ? "Everyone"
      : c.type === "clan"
        ? ["", "Virtus", "Sapientia", "Constantia", "Libertas"][c.clan_id || 0]
        : c.type === "club"
          ? q.data?.clubs.find((x) => x.id === c.club_id)?.name || "Club"
          : name(other(c));
  return (
    <Frame
      title="Say hello."
      subtitle="Direct messages begin after an invitation is accepted."
    >
      <Feedback state={q} />
      <Feedback state={a} />
      <Choices
        label="Conversations"
        value={selected}
        onChange={setSelected}
        options={(q.data?.conversations || []).map((c) => ({
          id: c.id,
          label:
            label(c) + (c.direct_status === "pending" ? " · invitation" : ""),
        }))}
      />
      {active && (
        <Card>
          <H>{label(active)}</H>
          {active.type !== "direct" || active.direct_status === "active" ? (
            <Messages
              key={active.id}
              id={active.id}
              userId={userId}
              profiles={q.data?.profiles || []}
            />
          ) : (
            <>
              <P>
                {active.direct_status === "declined"
                  ? "Invitation declined."
                  : active.requested_by === userId
                    ? "Waiting for acceptance."
                    : "You have a chat invitation."}
              </P>
              {active.direct_status === "pending" &&
                active.requested_by !== userId &&
                [true, false].map((accept) => (
                  <Button
                    key={String(accept)}
                    disabled={a.busy}
                    secondary={!accept}
                    onPress={() =>
                      void a.run(async () => {
                        await rpc("pc_respond_direct_chat", {
                          p_conversation_id: active.id,
                          p_accept: accept,
                        });
                        q.reload();
                      })
                    }
                  >
                    {accept ? "Accept" : "Decline"}
                  </Button>
                ))}
            </>
          )}
          {active.type === "direct" && (
            <Button
              secondary
              disabled={a.busy}
              onPress={() =>
                Confirm(
                  "Block member?",
                  "Both accounts will lose access to this conversation.",
                  () =>
                    void a.run(async () => {
                      checked(
                        await db
                          .from("user_blocks")
                          .insert({
                            blocker_id: userId,
                            blocked_id: other(active),
                          }),
                      );
                      setSelected("");
                      q.reload();
                    }),
                )
              }
            >
              Block member
            </Button>
          )}
        </Card>
      )}
      <Card>
        <H>Start a direct conversation</H>
        <Field
          label="Find a member"
          value={search}
          onChange={setSearch}
          maxLength={80}
        />
        <Choices
          label="Member"
          value={person}
          onChange={setPerson}
          options={(q.data?.profiles || [])
            .filter(
              (p) =>
                p.id !== userId &&
                p.display_name.toLowerCase().includes(search.toLowerCase()) &&
                !q.data?.blocks.some((b) => b.blocked_id === p.id),
            )
            .slice(0, 30)
            .map((p) => ({ id: p.id, label: p.display_name }))}
        />
        <Button
          disabled={a.busy || !person}
          onPress={() =>
            void a.run(async () => {
              setSelected(
                await rpc<string>("pc_request_direct_chat", {
                  p_other_user: person,
                }),
              );
              q.reload();
            }, "Invitation created.")
          }
        >
          Request chat
        </Button>
        {q.data?.blocks.map((b) => (
          <Button
            key={b.blocked_id}
            secondary
            disabled={a.busy}
            onPress={() =>
              void a.run(async () => {
                checked(
                  await db
                    .from("user_blocks")
                    .delete()
                    .eq("blocker_id", userId)
                    .eq("blocked_id", b.blocked_id),
                );
                q.reload();
              })
            }
          >
            Unblock {name(b.blocked_id)}
          </Button>
        ))}
      </Card>
    </Frame>
  );
}
function Messages({
  id,
  userId,
  profiles,
}: {
  id: string;
  userId: string;
  profiles: Profile[];
}) {
  const [body, setBody] = useState(""),
    [page, setPage] = useState(0),
    a = useAction(),
    pending = useRef<{ body: string; uuid: string } | null>(null);
  const sage = useAccountData().data?.items.some(
    (i) => i.type === "chat_bubble",
  );
  const q = useData(
    "messages-" + id + "-" + page,
    async () =>
      (
        checked(
          await db
            .from("messages")
            .select("*")
            .eq("conversation_id", id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(page * 30, page * 30 + 29),
        ) as Message[]
      ).reverse(),
    ["messages"],
  );
  return (
    <>
      <Feedback state={q} />
      <View style={ui.row}>
        <Button
          secondary
          disabled={!q.data || q.data.length < 30}
          onPress={() => setPage((p) => p + 1)}
        >
          Older
        </Button>
        <Button
          secondary
          disabled={!page}
          onPress={() => setPage((p) => p - 1)}
        >
          Newer
        </Button>
      </View>
      {q.data?.map((m) => (
        <View
          key={m.id}
          style={{
            gap: 8,
            borderRadius: 12,
            padding: 12,
            backgroundColor:
              m.sender_id === userId
                ? sage
                  ? "#cadcc6"
                  : "#edf2e9"
                : "#f7f5ef",
          }}
        >
          <H>
            {profiles.find((p) => p.id === m.sender_id)?.display_name ||
              "Athlete"}
          </H>
          <P>{m.body}</P>
          <P>{date(m.created_at)}</P>
          {m.sender_id !== userId && !m.removed_at && (
            <Report kind="message" id={m.id} />
          )}
        </View>
      ))}
      <Field label="Message" value={body} onChange={setBody} multiline />
      <Button
        disabled={a.busy || !body.trim()}
        onPress={() => {
          const text = body.trim();
          if (pending.current?.body !== text)
            pending.current = { body: text, uuid: randomUUID() };
          const retry = pending.current;
          void a.run(async () => {
            await rpc("pc_send_message", {
              p_conversation_id: id,
              p_body: text,
              p_client_message_id: retry.uuid,
            });
            pending.current = null;
            setBody("");
            setPage(0);
            q.reload();
          }, "Sent.");
        }}
      >
        Send
      </Button>
      <Feedback state={a} />
    </>
  );
}
