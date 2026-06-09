package com.acat.crawler.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_book")
public class BookEntity {
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private String title;
    private Long authorId;
    private Long coverId;
    private String description;
    private String category;
    private String status;
    private Long wordCount;
    private Integer chapterCount;
    private Double rating;

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
