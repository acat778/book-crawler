package com.acat.crawler.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_book_chapter")
public class BookChapterEntity {
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private Long bookId;
    private String title;
    private Integer wordCount;
    private Integer sortOrder;

    @TableLogic
    @TableField(select = false)
    private Integer isDeleted;
    @TableField(fill = FieldFill.INSERT)
    private Long createBy;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Long updateBy;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @Version
    @TableField(fill = FieldFill.INSERT)
    private Integer version;
}
