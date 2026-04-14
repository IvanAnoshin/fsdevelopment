import {
  PostAuthAvatarStack,
  PostAuthEmptyState,
  PostAuthFilterChips,
  PostAuthHero,
  PostAuthNoticeCard,
  PostAuthPostCard,
  PostAuthSectionHead,
  PostAuthSkeletonPostCard,
  PostAuthSummaryCard,
} from '../../components/postauth';
import { buildSrcSet, getMediaPoster, isVideoMedia, mediaPreviewText } from '../../utils/media';
import { buildCommentTree, isCommentEdited } from '../../utils/comments';

function initials(user) {
  return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || 'U';
}

function shouldSubmitOnEnter(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229;
}

function formatDate(value) {
  if (!value) return 'только что';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'только что';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function mediaSummary(images) {
  return mediaPreviewText(images);
}

function renderMediaGrid(items, onOpenMedia, title = 'Фото') {
  return (
    <div className="pa-optimized-media-grid">
      {items.map((item, index) => {
        const src = item?.display?.url || item?.src || item?.full?.url || item?.thumb?.url;
        if (!src) return null;
        const key = item?.asset_id || item?.hash || `${src}-${index}`;
        const isVideo = isVideoMedia(item);
        const srcSet = isVideo ? '' : buildSrcSet(item);
        const poster = getMediaPoster(item);
        return (
          <button key={key} type="button" className={`pa-optimized-media-item pa-reset-button ${isVideo ? 'is-video' : ''}`.trim()} onClick={() => onOpenMedia?.(items, index, title)}>
            {isVideo ? (
              <>
                <video
                  className="pa-optimized-media-img"
                  src={src}
                  poster={poster || undefined}
                  preload="metadata"
                  playsInline
                  muted
                  aria-label={item?.alt || 'Видео в посте'}
                />
                <span className="pa-optimized-media-play">▶</span>
              </>
            ) : (
              <img
                className="pa-optimized-media-img"
                src={src}
                srcSet={srcSet || undefined}
                sizes="(max-width: 768px) 100vw, 720px"
                loading="lazy"
                decoding="async"
                alt={item?.alt || 'Вложение к посту'}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function CommentThread({ comment, postId, postAuthorId, currentUserId, onReplyComment, onEditComment, onDeleteComment, onVoteComment, onToggleCommentReplies, onLoadMoreReplies, commentActionState, replyUiState, depth = 0 }) {
  const commentAuthor = comment.user || {};
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const totalReplies = Number(comment.reply_count || replies.length || 0);
  const canEdit = String(commentAuthor.id || comment.user_id || '') === String(currentUserId || '');
  const canDelete = canEdit || String(postAuthorId || '') === String(currentUserId || '');
  const actionState = commentActionState?.[comment.id] || '';
  const isBusy = actionState === 'deleting';
  const isVoteBusy = String(actionState).startsWith('vote:');
  const threadState = replyUiState?.[comment.id] || {};
  const isExpanded = Boolean(threadState.expanded);
  const isLoadingReplies = Boolean(threadState.loading);
  const hasMoreReplies = Boolean(threadState.hasMore);
  const currentVote = Number(comment.current_user_vote || 0);
  const replyLabel = totalReplies > 0 ? `${isExpanded ? 'Скрыть ответы' : 'Показать ответы'} (${totalReplies})` : null;
  return (
    <div className="pa-list" style={{ gap: 8, marginLeft: depth > 0 ? 18 : 0 }}>
      <div className="pa-feed-comment-card">
        <div className="pa-inline-row" style={{ marginBottom: 6, alignItems: 'center' }}>
          <div className="pa-avatar-xs">{initials(commentAuthor)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pa-name" style={{ fontSize: 13 }}>{commentAuthor.first_name || 'Пользователь'} {commentAuthor.last_name || ''}</div>
            <div className="pa-meta">{formatDate(comment.created_at)}{isCommentEdited(comment) ? ' · изменено' : ''}</div>
          </div>
        </div>
        <div className="pa-bio">{comment.content}</div>
        <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <div className="pa-inline-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className={`pa-comment-vote-btn ${currentVote === 1 ? 'active' : ''}`.trim()} type="button" disabled={isVoteBusy} onClick={() => onVoteComment?.(postId, comment, 1)}>
              <span>＋</span>
              <strong>{Number(comment.likes || 0)}</strong>
            </button>
            <button className={`pa-comment-vote-btn is-negative ${currentVote === -1 ? 'active' : ''}`.trim()} type="button" disabled={isVoteBusy} onClick={() => onVoteComment?.(postId, comment, -1)}>
              <span>－</span>
              <strong>{Number(comment.dislikes || 0)}</strong>
            </button>
            <button className="pa-link-btn" type="button" onClick={() => onReplyComment?.(postId, comment)}>Ответить</button>
            {replyLabel ? <button className="pa-link-btn" type="button" onClick={() => onToggleCommentReplies?.(postId, comment)}>{replyLabel}</button> : null}
            {canEdit ? <button className="pa-link-btn" type="button" onClick={() => onEditComment?.(postId, comment)}>Редактировать</button> : null}
            {canDelete ? <button className="pa-link-btn" type="button" onClick={() => onDeleteComment?.(postId, comment)} disabled={isBusy}>{isBusy ? 'Удаляю…' : 'Удалить'}</button> : null}
          </div>
        </div>
      </div>
      {isExpanded ? (
        <>
          {isLoadingReplies && replies.length === 0 ? <div className="pa-meta" style={{ marginLeft: 4 }}>Загружаю ответы…</div> : null}
          {replies.length > 0 ? replies.map((reply) => (
            <CommentThread key={reply.id || `${postId}-${reply.created_at}-${reply.content}`} comment={reply} postId={postId} postAuthorId={postAuthorId} currentUserId={currentUserId} onReplyComment={onReplyComment} onEditComment={onEditComment} onDeleteComment={onDeleteComment} onVoteComment={onVoteComment} onToggleCommentReplies={onToggleCommentReplies} onLoadMoreReplies={onLoadMoreReplies} commentActionState={commentActionState} replyUiState={replyUiState} depth={depth + 1} />
          )) : null}
          {hasMoreReplies ? <button className="pa-link-btn" type="button" onClick={() => onLoadMoreReplies?.(postId, comment)} disabled={isLoadingReplies}>{isLoadingReplies ? 'Загружаю…' : 'Показать ещё ответы'}</button> : null}
        </>
      ) : null}
    </div>
  );
}

export function FeedHeaderBlock({
  bucketStats,
  heroPeople,
  targetPostId,
  visibleCountLabel,
  targetPostLoading,
  focusedPostId,
  clearFocusedPost,
  refreshing,
  loadFeed,
  error,
  visiblePosts,
  activeTab,
  setActiveTab,
  feedTabs,
  composerInputRef,
  newPost,
  setNewPost,
  handleCreatePost,
  posting,
  focusComposer,
  recommendationNotice,
  onUndoLastFeedPreference,
  onDismissRecommendationNotice,
  undoingFeedPreference,
  onOpenRecommendationCenter,
}) {
  return (
    <>
      <PostAuthHero
        className="pa-feed-hero"
        badge={<span className="pa-pill accent">Новая лента</span>}
        title="Ваше пространство друзей, подписок и общих обсуждений"
        text="Стабильная логика ленты уже подключена к API. Большой экран теперь разбит на крупные блоки, чтобы код оставался живым и внятным без россыпи мелких файлов."
        stats={[
          { key: 'friends', value: bucketStats.friends || 0, label: 'Друзья' },
          { key: 'following', value: bucketStats.following || 0, label: 'Подписки' },
          { key: 'recommended', value: bucketStats.recommended || 0, label: 'Рекомендации' },
        ]}
        visual={heroPeople.length > 0 ? <div className="pa-feed-hero-stack">{heroPeople.map((person) => <div key={person.id} className="pa-avatar-sm">{initials(person)}</div>)}</div> : null}
      />

      <section className="pa-card pa-feed-controls">
        <div className="pa-pill-row pa-feed-tabs">
          {feedTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`pa-feed-tab ${activeTab === tab.key ? 'active' : ''}`.trim()}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pa-feed-composer">
          <div className="pa-message-input-wrap pa-feed-composer-input-wrap">
            <input
              ref={composerInputRef}
              className="pa-input"
              value={newPost}
              onChange={(e) => setNewPost(e.target.value)}
              placeholder="Поделитесь новостью, мыслью или обновлением"
              onKeyDown={(e) => { if (shouldSubmitOnEnter(e)) { e.preventDefault(); handleCreatePost(); } }}
            />
          </div>
        </div>
        <div className="pa-feed-composer-actions">
          <button className="pa-secondary-btn" type="button" onClick={focusComposer}>Фокус</button>
          <button className="pa-primary-btn" type="button" onClick={handleCreatePost} disabled={posting || !newPost.trim()}>{posting ? 'Публикую…' : 'Опубликовать'}</button>
        </div>
      </section>

      {recommendationNotice ? (
        <PostAuthNoticeCard
          className="pa-feed-recommendation-notice"
          title={recommendationNotice.title}
          text={recommendationNotice.text}
          tone="blue"
          actions={(
            <>
              <button className="pa-link-btn" type="button" onClick={onDismissRecommendationNotice}>Скрыть</button>
              <button className="pa-secondary-btn" type="button" onClick={onUndoLastFeedPreference} disabled={undoingFeedPreference}>{undoingFeedPreference ? 'Отменяю…' : 'Отменить'}</button>
            </>
          )}
        />
      ) : null}

      <PostAuthSectionHead
        className="pa-feed-section-head"
        title={targetPostId ? 'Открытый пост' : visibleCountLabel}
        meta={`${visiblePosts.length} постов${targetPostLoading ? ' · открываю пост…' : ''}`}
        actions={(
          <>
            {(focusedPostId || targetPostId) && (
              <button className="pa-link-btn" type="button" onClick={clearFocusedPost}>К ленте</button>
            )}
            {activeTab === 'recommended' ? <button className="pa-link-btn" type="button" onClick={onOpenRecommendationCenter}>Настроить рекомендации</button> : null}
            <button className="pa-link-btn" type="button" onClick={() => loadFeed(1, true)} disabled={refreshing}>
              {refreshing ? 'Обновляю…' : 'Обновить'}
            </button>
          </>
        )}
      />

      {error && visiblePosts.length > 0 && <div className="pa-error" style={{ marginBottom: 12 }}>{error}</div>}
    </>
  );
}

export function FeedBodyBlock({
  navigate,
  loading,
  error,
  visiblePosts,
  targetPostId,
  focusedPostId,
  clearFocusedPost,
  focusComposer,
  loadFeed,
  refreshing,
  currentUserId,
  currentUser,
  commentsByPost,
  commentsOpen,
  commentsLoading,
  commentInputs,
  commentSubmitting,
  commentSorts,
  editingTargets,
  commentActionState,
  replyUiState,
  postRefs,
  getFeedReason,
  targetPostLoading,
  toggleLike,
  toggleComments,
  submitComment,
  replyTargets,
  onReplyComment,
  onEditComment,
  onDeleteComment,
  onVoteComment,
  onToggleCommentReplies,
  onLoadMoreReplies,
  clearReplyTarget,
  clearEditTarget,
  setCommentSort,
  setCommentInputs,
  handleAuthorAction,
  authorActionId,
  authorActionLabel,
  handleDeletePost,
  deletingPostId,
  likingPostId,
  onOpenMedia,
  openSavePost,
  activeTab,
  onOpenExplainPost,
  onFeedPreference,
  feedSignalState,
  getFeedTopic,
  page,
  hasMore,
  loadingMore,
}) {
  if (loading) {
    return (
      <div className="pa-skeleton-grid pa-skeleton-grid-posts">
        <PostAuthSkeletonPostCard />
        <PostAuthSkeletonPostCard compact />
        <PostAuthSkeletonPostCard />
      </div>
    );
  }

  if (error && visiblePosts.length === 0) {
    return (
      <PostAuthEmptyState
        title="Не удалось загрузить ленту"
        text={error}
        icon="🛰️"
        primaryAction={{ label: 'Повторить', onClick: () => loadFeed(1, true) }}
        secondaryAction={{ label: 'Открыть людей', onClick: () => navigate('/friends') }}
      />
    );
  }

  if (visiblePosts.length === 0) {
    return (
      <PostAuthEmptyState
        title={targetPostId ? 'Пост не найден' : 'В этой вкладке пока пусто'}
        text={targetPostId ? 'Попробуйте вернуться в общую ленту или обновить данные.' : 'Переключитесь на другую вкладку, подпишитесь на людей или опубликуйте первый пост.'}
        icon={targetPostId ? '🔎' : '📰'}
        primaryAction={{ label: targetPostId ? 'К ленте' : 'Создать пост', onClick: targetPostId ? clearFocusedPost : focusComposer }}
        secondaryAction={{ label: 'Открыть людей', onClick: () => navigate('/friends') }}
        tertiaryAction={{ label: refreshing ? 'Обновляю…' : 'Обновить', onClick: () => loadFeed(1, true), disabled: refreshing }}
      />
    );
  }

  return (
    <>
      <div className="pa-list pa-feed-list">
        {(focusedPostId || targetPostId) && (
          <PostAuthNoticeCard
            className="pa-feed-inline-banner pa-glass"
            tone="accent"
            icon="🧭"
            title="Открыт конкретный пост"
            text="Можно вернуться к обычной ленте или сразу создать свой пост."
            actions={[
              { key: 'create', label: 'Создать пост', onClick: focusComposer, className: 'pa-secondary-btn' },
              { key: 'back', label: 'К ленте', onClick: clearFocusedPost, className: 'pa-primary-btn' },
            ]}
          />
        )}

        {visiblePosts.map((post) => {
          const author = post.user || post.author || currentUser;
          const comments = commentsByPost[post.id] || [];
          const commentTree = buildCommentTree(comments, commentSorts?.[post.id] || 'oldest');
          const replyTarget = replyTargets?.[post.id] || null;
          const editingTarget = editingTargets?.[post.id] || null;
          const canDelete = String(author?.id || post.user_id || '') === currentUserId;
          const reason = getFeedReason(activeTab, post, currentUserId);
          return (
            <div key={post.id} ref={(node) => { postRefs.current[String(post.id)] = node; }}>
              <PostAuthPostCard
                className={`pa-feed-post ${String(focusedPostId) === String(post.id) ? 'pa-post-card-focused' : ''}`.trim()}
                badge={<div className={`pa-feed-reason pa-feed-reason-${reason.tone}`}>{reason.label}</div>}
                author={author}
                avatarLabel={initials(author)}
                title={`${author.first_name || 'Пользователь'} ${author.last_name || ''}`.trim()}
                subtitle={`@${author.username || 'user'}`}
                meta={formatDate(post.created_at)}
                onOpenProfile={() => navigate(author?.id ? `/profile/${author.id}` : '/profile')}
                trailing={(
                  <div className="pa-pill-row pa-postauth-post-visibility" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <span className="pa-pill neutral">{post.visibility || 'публично'}</span>
                    {!canDelete && author?.friendship_status !== 'self' && (
                      <button
                        className={`pa-feed-author-action ${author?.friendship_status === 'request_sent' ? 'is-pending' : ''}`.trim()}
                        type="button"
                        disabled={authorActionId === author.id || author?.friendship_status === 'request_sent'}
                        onClick={() => author?.friendship_status === 'friends' ? navigate(`/messages/${author.id}`) : handleAuthorAction(author)}
                      >
                        {authorActionId === author.id ? '...' : authorActionLabel(author)}
                      </button>
                    )}
                    {canDelete && (
                      <button className="pa-secondary-btn" type="button" onClick={() => handleDeletePost(post.id)} disabled={deletingPostId === post.id}>
                        {deletingPostId === post.id ? 'Удаляю…' : 'Удалить'}
                      </button>
                    )}
                  </div>
                )}
                highlight={String(focusedPostId) === String(post.id) ? <span className="pa-pill accent">Открыто из уведомления</span> : null}
                content={post.content}
                media={post.images.length > 0 ? (
                  <div className="pa-feed-media-card">
                    <div className="pa-feed-media-preview is-real-media">
                      <div className="pa-feed-media-badge">{mediaSummary(post.images)}</div>
                      <div className="pa-feed-media-title">Оптимизированные вложения</div>
                      <div className="pa-feed-media-text">Лента загружает уменьшенный вариант, а полный файл открывается только по запросу.</div>
                    </div>
                    {renderMediaGrid(post.images.map((item) => ({ ...item, source_post_id: post.id, owner_id: author?.id || post?.user_id || null, owner_username: author?.username || '' })), onOpenMedia, `Фото @${author?.username || "user"}`)}
                  </div>
                ) : null}
                actions={[
                  { key: 'like', label: post.liked ? 'Убрать лайк' : 'Лайк', value: post.likes_count, onClick: () => toggleLike(post), active: post.liked, tone: 'primary', busy: likingPostId === post.id, busyLabel: '...' },
                  { key: 'comments', label: 'Комментарии', value: post.comments_count, onClick: () => toggleComments(post.id), tone: 'secondary' },
                  { key: 'save', label: 'В подборку', onClick: () => openSavePost?.(post), tone: 'secondary' },
                ]}
                footerAside={post.views_count !== null ? <span className="pa-pill blue">Просмотры · {post.views_count}</span> : null}
              >
                {activeTab === 'recommended' ? (
                  <>
                    <div className="pa-inline-row pa-feed-recommendation-meta" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 10, marginBottom: 8 }}>
                      <div className="pa-pill-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {(Array.isArray(post.recommended_signals) ? post.recommended_signals : []).slice(0, 3).map((signal) => (
                          <span key={`${post.id}-${signal}`} className="pa-pill neutral">{signal}</span>
                        ))}
                      </div>
                      <button className="pa-link-btn" type="button" onClick={() => onOpenExplainPost?.(post)}>Почему я это вижу?</button>
                    </div>
                    <div className="pa-inline-row pa-feed-recommendation-controls" style={{ gap: 12, flexWrap: 'wrap', marginTop: 0, marginBottom: commentsOpen[post.id] ? 10 : 0 }}>
                      <button className="pa-link-btn" type="button" disabled={Boolean(feedSignalState?.[`not_interested:${post.id}`])} onClick={() => onFeedPreference?.(post, 'not_interested')}>
                        {feedSignalState?.[`not_interested:${post.id}`] ? 'Сохраняю…' : 'Не интересно'}
                      </button>
                      <button className="pa-link-btn" type="button" disabled={Boolean(feedSignalState?.[`less_like_this:${post.id}`])} onClick={() => onFeedPreference?.(post, 'less_like_this')}>
                        {feedSignalState?.[`less_like_this:${post.id}`] ? 'Сохраняю…' : 'Показывать меньше такого'}
                      </button>
                      <button className="pa-link-btn" type="button" disabled={Boolean(feedSignalState?.[`hide_author:${post.id}`])} onClick={() => onFeedPreference?.(post, 'hide_author')}>
                        {feedSignalState?.[`hide_author:${post.id}`] ? 'Скрываю…' : 'Скрыть автора'}
                      </button>
                      {getFeedTopic?.(post.content) ? (
                        <button className="pa-link-btn" type="button" disabled={Boolean(feedSignalState?.[`hide_topic:${post.id}`])} onClick={() => onFeedPreference?.(post, 'hide_topic')}>
                          {feedSignalState?.[`hide_topic:${post.id}`] ? 'Скрываю…' : `Скрыть #${getFeedTopic(post.content)}`}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {commentsOpen[post.id] && (
                  <div className="pa-feed-comments-panel">
                    {commentsLoading[post.id] ? (
                      <div className="pa-meta">Загружаю комментарии…</div>
                    ) : comments.length === 0 ? (
                      <div className="pa-meta">Комментариев пока нет. Будьте первым.</div>
                    ) : (
                      <>
                        <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          <div className="pa-pill-row" style={{ gap: 6 }}>
                            {[
                              { key: 'oldest', label: 'Сначала старые' },
                              { key: 'newest', label: 'Сначала новые' },
                              { key: 'discussed', label: 'Обсуждаемые' },
                            ].map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                className={`pa-feed-tab ${(commentSorts?.[post.id] || 'oldest') === option.key ? 'active' : ''}`.trim()}
                                onClick={() => setCommentSort?.(post.id, option.key)}
                                style={{ padding: '8px 10px', minHeight: 0, fontSize: 12 }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div className="pa-meta">{Number(post.comments_count || comments.length)} комментариев</div>
                        </div>
                        <div className="pa-list" style={{ gap: 8, marginBottom: 10 }}>
                          {commentTree.map((comment) => (
                            <CommentThread key={comment.id || `${post.id}-${comment.created_at}-${comment.content}`} comment={comment} postId={post.id} postAuthorId={author?.id || post?.user_id} currentUserId={currentUserId} onReplyComment={onReplyComment} onEditComment={onEditComment} onDeleteComment={onDeleteComment} onVoteComment={onVoteComment} onToggleCommentReplies={onToggleCommentReplies} onLoadMoreReplies={onLoadMoreReplies} commentActionState={commentActionState} replyUiState={replyUiState?.[post.id] || {}} />
                          ))}
                        </div>
                      </>
                    )}
                    {editingTarget ? (
                      <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div className="pa-meta">Редактирование комментария</div>
                        <button className="pa-link-btn" type="button" onClick={() => clearEditTarget?.(post.id)}>Отменить</button>
                      </div>
                    ) : replyTarget ? (
                      <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div className="pa-meta">Ответ @{replyTarget?.user?.username || 'user'}{replyTarget?._depthLimited ? ' · без нового уровня' : ''}</div>
                        <button className="pa-link-btn" type="button" onClick={() => clearReplyTarget?.(post.id)}>Отменить</button>
                      </div>
                    ) : null}
                    <div className="pa-composer pa-feed-comment-composer" style={{ marginTop: 0, marginBottom: 0, padding: 8 }}>
                      <div className="pa-avatar-xs">{initials(currentUser)}</div>
                      <div className="pa-message-input-wrap">
                        <input className="pa-input" value={commentInputs[post.id] || ''} onChange={(e) => setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))} placeholder={editingTarget ? 'Изменить комментарий' : replyTarget ? 'Написать ответ' : 'Написать комментарий'} onKeyDown={(e) => { if (shouldSubmitOnEnter(e)) { e.preventDefault(); submitComment(post.id); } }} />
                      </div>
                      <button className="pa-secondary-btn" type="button" onClick={() => submitComment(post.id)} disabled={commentSubmitting[post.id] || !(commentInputs[post.id] || '').trim()}>{commentSubmitting[post.id] ? 'Сохраняю…' : (editingTarget ? 'Сохранить' : replyTarget ? 'Ответить' : 'Отправить')}</button>
                    </div>
                  </div>
                )}
              </PostAuthPostCard>
            </div>
          );
        })}
      </div>

      {hasMore && !targetPostId && !targetPostLoading && (
        <div style={{ marginTop: 12 }}>
          <button className="pa-secondary-btn" type="button" style={{ width: '100%' }} onClick={() => loadFeed(page + 1)} disabled={loadingMore}>{loadingMore ? 'Загружаю…' : 'Показать ещё'}</button>
        </div>
      )}
    </>
  );
}


function preferenceTypeLabel(type) {
  switch (type) {
    case 'not_interested': return 'Скрытый пост';
    case 'hide_author': return 'Скрытый автор';
    case 'hide_topic': return 'Скрытая тема';
    case 'less_like_this': return 'Меньше похожего';
    default: return 'Сигнал';
  }
}

export function FeedRecommendationCenterModal({ open, loading, items, restoringId, onClose, onRefresh, onRestore }) {
  if (!open) return null;
  const grouped = (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const key = item?.type || 'other';
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="pa-overlay" onClick={onClose}>
      <div className="pa-modal-wrap" onClick={(event) => event.stopPropagation()}>
        <div className="pa-modal pa-feed-pref-modal">
          <div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div>
              <div className="pa-title" style={{ fontSize: 20 }}>Настройки рекомендаций</div>
              <div className="pa-meta">Можно быстро посмотреть скрытые посты, авторов и темы, а затем вернуть их обратно.</div>
            </div>
            <button className="pa-icon-btn" type="button" onClick={onClose} aria-label="Закрыть">✕</button>
          </div>

          <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <span className="pa-pill blue">{Array.isArray(items) ? items.length : 0} сигналов</span>
            <button className="pa-link-btn" type="button" onClick={onRefresh} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить список'}</button>
          </div>

          <div className="pa-feed-pref-list">
            {loading ? <div className="pa-meta">Загружаю настройки рекомендаций…</div> : null}
            {!loading && (!Array.isArray(items) || items.length === 0) ? (
              <PostAuthEmptyState title="Здесь пока пусто" text="Когда вы скрываете посты, темы или авторов, они появятся здесь." icon="✨" />
            ) : null}
            {!loading && Object.entries(grouped).map(([group, groupItems]) => (
              <section key={group} className="pa-card pa-feed-pref-section">
                <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                  <div className="pa-name">{preferenceTypeLabel(group)}</div>
                  <div className="pa-meta">{groupItems.length}</div>
                </div>
                <div className="pa-list" style={{ gap: 8 }}>
                  {groupItems.map((item) => (
                    <div key={item.id} className="pa-feed-pref-item">
                      <div className="pa-feed-pref-copy">
                        <div className="pa-name" style={{ fontSize: 14 }}>{item.title || preferenceTypeLabel(item.type)}</div>
                        <div className="pa-meta">{item.author ? `@${item.author.username || 'user'} · ` : ''}{item.topic ? `#${item.topic} · ` : ''}{item.post?.content || item.description}</div>
                      </div>
                      <button className="pa-secondary-btn" type="button" onClick={() => onRestore?.(item)} disabled={restoringId === item.id}>
                        {restoringId === item.id ? 'Возвращаю…' : 'Вернуть'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeedRecommendationExplainModal({ open, post, onClose }) {
  if (!open || !post) return null;
  const signals = Array.isArray(post.recommended_signals) ? post.recommended_signals : [];
  const topic = post.recommended_topic || '';
  return (
    <div className="pa-overlay" onClick={onClose}>
      <div className="pa-modal-wrap" onClick={(event) => event.stopPropagation()}>
        <div className="pa-modal pa-feed-explain-modal">
          <div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div>
              <div className="pa-title" style={{ fontSize: 20 }}>Почему вы видите этот пост</div>
              <div className="pa-meta">Лента учитывает свежесть, обсуждаемость, темы и ваши собственные сигналы.</div>
            </div>
            <button className="pa-icon-btn" type="button" onClick={onClose} aria-label="Закрыть">✕</button>
          </div>

          <div className="pa-card pa-feed-explain-card">
            <div className="pa-name" style={{ marginBottom: 6 }}>{post.recommended_reason || 'Рекомендация ленты'}</div>
            <div className="pa-meta">{topic ? `Основная тема: #${topic}` : 'Темы не определены явно — пост попал в ленту по общим сигналам.'}</div>
            <div className="pa-pill-row pa-feed-signal-list">
              {signals.length ? signals.map((signal) => <span key={`${post.id}-${signal}`} className="pa-pill neutral">{signal}</span>) : <span className="pa-meta">Подобрано по общему скорингу ленты.</span>}
            </div>
          </div>

          <div className="pa-card pa-feed-explain-card">
            <div className="pa-name" style={{ marginBottom: 6 }}>Как настроить выдачу</div>
            <div className="pa-meta">Скрывайте темы и авторов, а сигнал “меньше такого” мягко снижает вес похожих постов вместо одного жёсткого скрытия.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
