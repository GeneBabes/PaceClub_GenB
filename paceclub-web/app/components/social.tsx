"use client";
import { useRef, useState } from "react";
import type {
  Club,
  Conversation,
  Message,
  Post,
  Profile,
  RemoteActivity,
} from "@/lib/full-types";
import {
  checked,
  db,
  date,
  Feedback,
  km,
  Photo,
  rpc,
  useAction,
  useData,
} from "./data";
import { PageTitle } from "./overview";
async function photoBlob(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw Error("Choose a JPG, PNG, or WebP under 10 MiB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Image conversion unavailable.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.75),
    );
    if (!blob || blob.size > 5 * 1024 * 1024)
      throw Error("Choose a smaller photo.");
    return blob;
  } finally {
    image.close();
  }
}
export function Community({ userId }: { userId: string }) {
  const [page, setPage] = useState(0);
  const q = useData(
    "feed-" + page,
    () => rpc<Post[]>("pc_feed", { p_offset: page * 20 }),
    ["activity_posts", "post_kudos", "post_comments"],
  );
  return (
    <>
      <PageTitle
        eyebrow="SMALL WINS, SHARED"
        title="Good company. Good progress."
        text="Share a moment from your activity. Your raw GPS route stays private."
      />
      <details className="card">
        <summary>Share a verified activity</summary>
        <Publish userId={userId} reload={q.reload} />
      </details>
      <Feedback state={q} />
      {q.data?.map((p) => (
        <PostCard key={p.id} post={p} userId={userId} reload={q.reload} />
      ))}
      {q.data?.length === 0 && (
        <section className="card empty-note">
          Your community’s activity stories will appear here.
        </section>
      )}
      <div className="actions">
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button
          disabled={!q.data || q.data.length < 20}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
function Publish({ userId, reload }: { userId: string; reload: () => void }) {
  const a = useAction();
  const q = useData("publish", async () => ({
    activities: checked(
      await db()
        .from("activities")
        .select("id,activity_type,started_at")
        .eq("user_id", userId)
        .eq("status", "verified")
        .neq("source", "simulation")
        .order("started_at", { ascending: false })
        .limit(100),
    ) as RemoteActivity[],
    clubs: (await rpc<Club[]>("pc_club_directory")).filter((c) => c.my_role),
    posts: checked(
      await db()
        .from("activity_posts")
        .select("activity_id,photo_path")
        .eq("author_id", userId),
    ) as { activity_id: string; photo_path: string | null }[],
  }));
  const [visibility, setVisibility] = useState("private");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = new FormData(form);
        void a.run(async () => {
          const id = String(f.get("activity"));
          let path =
            q.data?.posts.find((p) => p.activity_id === id)?.photo_path || null;
          const file = f.get("photo");
          if (file instanceof File && file.size) {
            const blob = await photoBlob(file);
            path = `${userId}/${id}/${crypto.randomUUID()}.jpg`;
            const { error } = await db()
              .storage.from("activity-photos")
              .upload(path, blob, { contentType: "image/jpeg" });
            if (error) throw error;
          }
          await rpc("pc_publish_activity", {
            p_id: id,
            p_caption: f.get("caption"),
            p_visibility: visibility,
            p_club: visibility === "club" ? f.get("club") : null,
            p_photo: path,
          });
          form.reset();
          reload();
        }, "Activity shared. Your route remains private.");
      }}
    >
      <Feedback state={q} />
      <label>
        Verified activity
        <select required name="activity">
          <option value="">Choose an activity</option>
          {q.data?.activities.map((x) => (
            <option key={x.id} value={x.id}>
              {x.activity_type} · {date(x.started_at)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Caption
        <textarea name="caption" maxLength={2000} />
      </label>
      <label>
        Add a photo
        <input
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
        />
      </label>
      <label>
        Who can see this?
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="private">Only me</option>
          <option value="members">PaceClub members</option>
          <option value="club">Selected club</option>
        </select>
      </label>
      {visibility === "club" && (
        <label>
          Club
          <select name="club" required>
            {q.data?.clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button disabled={a.busy}>Share activity</button>
      <Feedback state={a} />
    </form>
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
  const a = useAction();
  const [comments, setComments] = useState(false);
  return (
    <article className="card">
      <div className="post-author">
        <Photo path={p.avatar_path} bucket="avatars" alt={p.display_name} />
        <div>
          <strong>{p.display_name}</strong>
          <p className="muted">
            {date(p.created_at)} · {p.visibility} · {p.source}
          </p>
        </div>
      </div>
      <Photo path={p.photo_path} alt="Photo shared with this activity" />
      <p>{p.caption}</p>
      <p>
        <strong>
          {p.activity_type.toUpperCase()} · {km(p.distance_m)} km
        </strong>{" "}
        <span className="status-pill verified">Verified</span>
      </p>
      <div className="post-actions">
        <button
          className="secondary"
          disabled={a.busy}
          onClick={() =>
            void a.run(
              async () => {
                checked(
                  p.liked
                    ? await db()
                        .from("post_kudos")
                        .delete()
                        .eq("post_id", p.id)
                        .eq("user_id", userId)
                    : await db()
                        .from("post_kudos")
                        .insert({ post_id: p.id, user_id: userId }),
                );
                reload();
              },
              p.liked ? "Kudos removed." : "Kudos sent.",
            )
          }
        >
          {p.liked ? "♥" : "♡"} {p.kudos} kudos
        </button>
        <button className="secondary" onClick={() => setComments(!comments)}>
          {p.comments} comments
        </button>
      </div>
      <Feedback state={a} />
      {p.author_id !== userId ? (
        <Report id={p.id} />
      ) : (
        <details>
          <summary>Change caption or privacy</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void a.run(async () => {
                const vis = String(f.get("visibility"));
                checked(
                  await db()
                    .from("activity_posts")
                    .update({
                      caption: f.get("caption"),
                      visibility: vis,
                      club_id: vis === "club" ? p.club_id : null,
                    })
                    .eq("id", p.id),
                );
                reload();
              });
            }}
          >
            <label>
              Caption
              <textarea
                name="caption"
                defaultValue={p.caption}
                maxLength={2000}
              />
            </label>
            <label>
              Visibility
              <select name="visibility" defaultValue={p.visibility}>
                <option value="private">Only me</option>
                <option value="members">Members</option>
                {p.club_id && <option value="club">Current club</option>}
              </select>
            </label>
            <button disabled={a.busy}>Save changes</button>
          </form>
        </details>
      )}
      {comments && <Comments postId={p.id} userId={userId} />}
    </article>
  );
}
function Report({ id, comment = false }: { id: string; comment?: boolean }) {
  const a = useAction();
  return (
    <details>
      <summary>Report {comment ? "comment" : "post"}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(
            () =>
              rpc("pc_report_content", {
                p_id: id,
                p_comment: comment,
                p_reason: f.get("reason"),
              }),
            "Report sent for moderator review.",
          );
        }}
      >
        <label>
          Reason
          <textarea name="reason" minLength={3} maxLength={1000} required />
        </label>
        <button disabled={a.busy}>Submit report</button>
        <Feedback state={a} />
      </form>
    </details>
  );
}
function Comments({ postId, userId }: { postId: string; userId: string }) {
  const a = useAction();
  const q = useData(
    "comments-" + postId,
    async () => {
      const rows = checked(
        await db()
          .from("post_comments")
          .select("id,user_id,body,created_at,removed_at")
          .eq("post_id", postId)
          .order("created_at")
          .limit(100),
      ) as {
        id: string;
        user_id: string;
        body: string;
        created_at: string;
        removed_at: string | null;
      }[];
      const profiles = rows.length
        ? (checked(
            await db()
              .from("profiles")
              .select("id,display_name")
              .in("id", [...new Set(rows.map((c) => c.user_id))]),
          ) as Profile[])
        : [];
      return rows.map((c) => ({
        ...c,
        name:
          profiles.find((p) => p.id === c.user_id)?.display_name || "Athlete",
      }));
    },
    ["post_comments"],
  );
  return (
    <>
      <Feedback state={q} />
      {q.data?.map((c) => (
        <div className="comment" key={c.id}>
          <strong>{c.name}</strong>
          <p>{c.body}</p>
          <small>{date(c.created_at)}</small>
          {c.user_id === userId ? (
            <button
              className="secondary"
              disabled={a.busy}
              onClick={() => {
                if (window.confirm("Delete your comment?"))
                  void a.run(async () => {
                    checked(
                      await db().from("post_comments").delete().eq("id", c.id),
                    );
                    q.reload();
                  });
              }}
            >
              Delete
            </button>
          ) : (
            !c.removed_at && <Report id={c.id} comment />
          )}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          void a.run(async () => {
            checked(
              await db()
                .from("post_comments")
                .insert({
                  post_id: postId,
                  user_id: userId,
                  body: f.get("body"),
                }),
            );
            form.reset();
            q.reload();
          }, "Comment added.");
        }}
      >
        <label>
          Add a comment
          <textarea name="body" minLength={1} maxLength={1000} required />
        </label>
        <button disabled={a.busy}>Post comment</button>
        <Feedback state={a} />
      </form>
    </>
  );
}
export function Chat({ userId }: { userId: string }) {
  const a = useAction(),
    [selected, setSelected] = useState("");
  const q = useData(
    "conversations",
    async () => ({
      conversations: checked(
        await db().from("conversations").select("*").order("created_at"),
      ) as Conversation[],
      profiles: checked(
        await db()
          .from("profiles")
          .select("id,display_name")
          .eq("is_active", true)
          .limit(200),
      ) as Profile[],
      clubs: await rpc<Club[]>("pc_club_directory"),
      blocks: checked(await db().from("user_blocks").select("blocked_id")) as {
        blocked_id: string;
      }[],
    }),
    ["conversations", "conversation_members"],
  );
  const active = q.data?.conversations.find((c) => c.id === selected);
  const label = (c: Conversation) =>
    c.type === "global"
      ? "Everyone"
      : c.type === "clan"
        ? ["", "Virtus", "Sapientia", "Constantia", "Libertas"][c.clan_id || 0]
        : c.type === "club"
          ? q.data?.clubs.find((x) => x.id === c.club_id)?.name || "Club"
          : q.data?.profiles.find(
              (p) =>
                p.id ===
                (c.direct_user_a === userId
                  ? c.direct_user_b
                  : c.direct_user_a),
            )?.display_name || "Direct message";
  return (
    <>
      <PageTitle
        eyebrow="A COMMUNITY IN CONVERSATION"
        title="Say hello."
        text="Global, clan, and club spaces. Direct conversations begin only after an invitation is accepted."
      />
      <Feedback state={q} />
      <Feedback state={a} />
      <details className="card">
        <summary>Start a direct conversation or manage blocks</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void a.run(async () => {
              const id = await rpc<string>("pc_request_direct_chat", {
                p_other_user: f.get("person"),
              });
              q.reload();
              setSelected(id);
            }, "Conversation invitation created.");
          }}
        >
          <label>
            Member
            <select name="person" required>
              <option value="">Choose a member</option>
              {q.data?.profiles
                .filter(
                  (p) =>
                    p.id !== userId &&
                    !q.data!.blocks.some((b) => b.blocked_id === p.id),
                )
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.display_name}
                  </option>
                ))}
            </select>
          </label>
          <button disabled={a.busy}>Request conversation</button>
        </form>
        {q.data?.blocks.map((b) => (
          <div className="list-row" key={b.blocked_id}>
            <span>
              {q.data?.profiles.find((p) => p.id === b.blocked_id)
                ?.display_name || "Blocked member"}
            </span>
            <button
              className="secondary"
              onClick={() =>
                void a.run(async () => {
                  checked(
                    await db()
                      .from("user_blocks")
                      .delete()
                      .eq("blocker_id", userId)
                      .eq("blocked_id", b.blocked_id),
                  );
                  q.reload();
                })
              }
            >
              Unblock
            </button>
          </div>
        ))}
      </details>
      <div className="conversation-layout">
        <div className="conversation-list">
          {q.data?.conversations.map((c) => (
            <button
              className={c.id === selected ? "" : "secondary"}
              key={c.id}
              onClick={() => setSelected(c.id)}
            >
              {label(c)}
              {c.direct_status === "pending" ? " · invitation" : ""}
            </button>
          ))}
        </div>
        <section className="card">
          {active ? (
            <>
              <h2>{label(active)}</h2>
              {active.type === "direct" && active.direct_status !== "active" ? (
                <>
                  <p>
                    {active.direct_status === "declined"
                      ? "This invitation was declined."
                      : active.requested_by === userId
                        ? "Waiting for the other member to accept."
                        : "You have a conversation invitation."}
                  </p>
                  {active.direct_status === "pending" &&
                    active.requested_by !== userId && (
                      <div className="actions">
                        {[true, false].map((accept) => (
                          <button
                            className={accept ? "" : "secondary"}
                            key={String(accept)}
                            disabled={a.busy}
                            onClick={() =>
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
                          </button>
                        ))}
                      </div>
                    )}
                </>
              ) : (
                <Messages
                  id={active.id}
                  userId={userId}
                  profiles={q.data?.profiles || []}
                />
              )}{" "}
              {active.type === "direct" && (
                <button
                  className="secondary"
                  disabled={a.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Block this member? Both accounts will lose access to this direct conversation.",
                      )
                    )
                      void a.run(async () => {
                        checked(
                          await db()
                            .from("user_blocks")
                            .insert({
                              blocker_id: userId,
                              blocked_id:
                                active.direct_user_a === userId
                                  ? active.direct_user_b
                                  : active.direct_user_a,
                            }),
                        );
                        setSelected("");
                        q.reload();
                      }, "Member blocked.");
                  }}
                >
                  Block member
                </button>
              )}
            </>
          ) : (
            <p className="empty-note">Choose a conversation to get started.</p>
          )}
        </section>
      </div>
    </>
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
  const a = useAction();
  const [page, setPage] = useState(0);
  const pending = useRef<{ id: string; body: string; uuid: string } | null>(
    null,
  );
  const q = useData(
    "messages-" + id + "-" + page,
    async () =>
      (
        checked(
          await db()
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
      <div className="actions">
        <button
          className="secondary"
          disabled={!q.data || q.data.length < 30}
          onClick={() => setPage((p) => p + 1)}
        >
          Older
        </button>
        <button
          className="secondary"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          Newer
        </button>
      </div>
      <div className="message-list">
        {q.data?.map((m) => (
          <div
            className={
              "message-bubble " + (m.sender_id === userId ? "mine" : "")
            }
            key={m.id}
          >
            <strong>
              {profiles.find((p) => p.id === m.sender_id)?.display_name ||
                "Athlete"}
            </strong>
            <p>{m.body}</p>
            <small>{date(m.created_at)}</small>
            {m.sender_id !== userId && !m.removed_at && (
              <details>
                <summary>Report message</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void a.run(
                      () =>
                        rpc("pc_report_message", {
                          p_message_id: m.id,
                          p_reason: f.get("reason"),
                        }),
                      "Report submitted.",
                    );
                  }}
                >
                  <label>
                    Reason
                    <input
                      name="reason"
                      minLength={3}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button disabled={a.busy}>Report</button>
                </form>
              </details>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            body = String(new FormData(form).get("body")).trim();
          if (
            !pending.current ||
            pending.current.id !== id ||
            pending.current.body !== body
          )
            pending.current = { id, body, uuid: crypto.randomUUID() };
          const retry = pending.current;
          void a.run(async () => {
            await rpc("pc_send_message", {
              p_conversation_id: id,
              p_body: body,
              p_client_message_id: retry.uuid,
            });
            pending.current = null;
            form.reset();
            setPage(0);
            q.reload();
          }, "Message sent.");
        }}
      >
        <label>
          Your message
          <textarea name="body" minLength={1} maxLength={2000} required />
        </label>
        <button disabled={a.busy}>Send</button>
        <Feedback state={a} />
      </form>
    </>
  );
}
